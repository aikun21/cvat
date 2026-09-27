# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

# Initialization for the desktop build, split so that the slow parts can be avoided
# or run in parallel by the Electron shell:
#
#   ensure_database()  - called by cvat.desktop.serve before the server starts:
#                        creates the db from a pre-migrated template on first start,
#                        runs migrations only if the schema fingerprint changed,
#                        creates the local desktop user
#   python -m cvat.desktop.init redis
#                      - Redis migrations and periodic jobs (in parallel with the server)
#   python -m cvat.desktop.init template <dir>
#                      - build time: migrate an empty db and save it as the template
#   python -m cvat.desktop.init opa-bundle <file>
#                      - build time: save the permission rules for OPA
#
# Environment: DJANGO_SETTINGS_MODULE=cvat.settings.desktop, CVAT_BASE_DIR,
# CVAT_DESKTOP_DB_TEMPLATE (directory with db.sqlite3 + schema.fingerprint, optional).

import hashlib
import os
import secrets
import shutil
import sqlite3
import sys
from pathlib import Path

FINGERPRINT_FILE = "schema.fingerprint"
TEMPLATE_DB_FILE = "db.sqlite3"


def _setup_django() -> None:
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "cvat.settings.desktop")

    import django

    django.setup()


def schema_fingerprint() -> str:
    """
    Cheap identity of the database schema this code expects: the list of migration files
    of CVAT plus the installed package versions (third-party apps have migrations too).
    Computing it only lists directories, unlike `migrate`, which imports all migrations.
    """
    import django

    backend_root = Path(__file__).resolve().parents[2]
    site_packages = Path(django.__file__).resolve().parents[1]

    items = sorted(
        p.relative_to(backend_root).as_posix()
        for p in (backend_root / "cvat").glob("apps/*/migrations/*.py")
    )
    items += sorted(p.name for p in site_packages.glob("*.dist-info"))
    return hashlib.sha256("\n".join(items).encode()).hexdigest()


def _db_path() -> Path:
    from django.conf import settings

    return Path(settings.DATABASES["default"]["NAME"])


def _checkpoint(db_path: Path) -> None:
    # fold the WAL into the main file so that the db is a single self-contained file
    with sqlite3.connect(db_path) as conn:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")


def ensure_database() -> None:
    from django.conf import settings
    from django.contrib.auth import get_user_model
    from django.core.management import call_command
    from django.db import connections

    db_path = _db_path()
    marker = Path(settings.BASE_DIR) / FINGERPRINT_FILE
    template_dir = os.getenv("CVAT_DESKTOP_DB_TEMPLATE")

    if not db_path.exists() and template_dir and (Path(template_dir) / TEMPLATE_DB_FILE).exists():
        shutil.copyfile(Path(template_dir) / TEMPLATE_DB_FILE, db_path)
        shutil.copyfile(Path(template_dir) / FINGERPRINT_FILE, marker)
        print("Database created from the template")

    fingerprint = schema_fingerprint()
    if marker.exists() and marker.read_text().strip() == fingerprint:
        print("Database schema is up to date")
    else:
        call_command("migrate", interactive=False, verbosity=1)
        marker.write_text(fingerprint)

    User = get_user_model()
    if not User.objects.filter(username=settings.DESKTOP_USERNAME).exists():
        # The password is never used: the desktop shell logs in automatically.
        User.objects.create_superuser(
            username=settings.DESKTOP_USERNAME,
            email="",
            password=secrets.token_urlsafe(32),
        )
        print(f"Created desktop user '{settings.DESKTOP_USERNAME}'")

    # the installed app ships collected static files; in development they are collected once
    if not (Path(settings.STATIC_ROOT) / "logo.svg").exists():
        call_command("collectstatic", interactive=False, verbosity=0)

    connections.close_all()


def init_redis() -> None:
    from django.core.management import call_command

    call_command("migrateredis")
    call_command("syncperiodicjobs")


def build_template(out_dir: Path) -> None:
    from django.conf import settings
    from django.core.management import call_command
    from django.db import connections

    db_path = _db_path()
    if db_path.exists():
        raise RuntimeError(f"{db_path} already exists, use an empty CVAT_BASE_DIR")

    call_command("migrate", interactive=False, verbosity=1)
    connections.close_all()
    _checkpoint(db_path)

    out_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(db_path, out_dir / TEMPLATE_DB_FILE)
    (out_dir / FINGERPRINT_FILE).write_text(schema_fingerprint())
    print(f"Database template saved to {out_dir} (base dir {settings.BASE_DIR})")


def build_opa_bundle(out_file: Path) -> None:
    # The permission rules are static .rego files of the installed apps (the same bundle the
    # server returns from /api/auth/rules), so OPA can load them at start without the server.
    from cvat.apps.iam.utils import get_opa_bundle

    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_bytes(get_opa_bundle()[0])
    print(f"OPA bundle saved to {out_file}")


def main() -> None:
    command = sys.argv[1] if len(sys.argv) > 1 else "all"
    _setup_django()

    if command == "redis":
        init_redis()
    elif command == "db":
        ensure_database()
    elif command == "template":
        build_template(Path(sys.argv[2]))
    elif command == "opa-bundle":
        build_opa_bundle(Path(sys.argv[2]))
    elif command == "all":
        ensure_database()
        init_redis()
    else:
        raise SystemExit(f"Unknown command: {command}")

    print("CVAT desktop initialization finished")


if __name__ == "__main__":
    main()
