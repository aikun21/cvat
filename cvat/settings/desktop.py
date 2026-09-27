# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

# Settings for the single-user Windows desktop build (Electron shell, no Docker).
# Differences from production:
# - SQLite instead of PostgreSQL
# - on-disk media cache uses Django's file cache instead of Kvrocks
# - files are sent by Django itself (no nginx), the UI is served by Django too
# - no egress proxy (smokescreen), no analytics

import os

from .production import *  # pylint: disable=wildcard-import

DESKTOP_MODE = True

ALLOWED_HOSTS = ["localhost", "127.0.0.1"]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
        "OPTIONS": {
            # the server and the worker are separate processes writing to the same file
            "timeout": 60,
            "transaction_mode": "IMMEDIATE",
            "init_command": "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;",
        },
    }
}

CACHES["media"] = {
    "BACKEND": "django.core.cache.backends.filebased.FileBasedCache",
    "LOCATION": CACHE_ROOT / "media",
    "TIMEOUT": CVAT_CHUNK_CACHE_TTL,
}

SENDFILE_BACKEND = "django_sendfile.backends.simple"

# Uploaded files are stored relative to the data directory. In the docker image the working
# directory is the data directory, here the server runs from the (read-only) install dir.
MEDIA_ROOT = BASE_DIR

SMOKESCREEN_ENABLED = False

# Built cvat-ui (dist) directory; when set, Django serves the UI on the same origin as the API.
DESKTOP_UI_ROOT = Path(os.environ["CVAT_DESKTOP_UI_ROOT"]) if os.getenv("CVAT_DESKTOP_UI_ROOT") else None

# Static files collected at build time and shipped with the app (read-only install dir).
if os.getenv("CVAT_DESKTOP_STATIC_ROOT"):
    STATIC_ROOT = Path(os.environ["CVAT_DESKTOP_STATIC_ROOT"])

# Automatic login of the local user for requests coming from the desktop shell,
# see cvat/desktop/auth.py. Without a token (e.g. in development) the usual login is used.
DESKTOP_USERNAME = "desktop"
DESKTOP_TOKEN = os.getenv("CVAT_DESKTOP_TOKEN", "")
MIDDLEWARE.insert(
    MIDDLEWARE.index("django.contrib.auth.middleware.AuthenticationMiddleware") + 1,
    "cvat.desktop.auth.DesktopAutoLoginMiddleware",
)
