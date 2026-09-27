# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

# Server entry point of the desktop build: prepares the database (see init.ensure_database)
# and starts uvicorn in the same process, so Django is loaded only once.
#
# Usage: python -m cvat.desktop.serve --host 127.0.0.1 --port 8080

import argparse
import os


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()

    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "cvat.settings.desktop")

    import django

    django.setup()

    from cvat.desktop.init import ensure_database

    ensure_database()

    import uvicorn

    uvicorn.run("cvat.asgi:application", host=args.host, port=args.port)


if __name__ == "__main__":
    main()
