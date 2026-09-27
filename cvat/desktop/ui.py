# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

# Serves the built cvat-ui from Django for the desktop build, where there is no
# separate UI container / reverse proxy in front of the server.

import mimetypes

from django.conf import settings
from django.http import FileResponse, Http404
from django.urls import re_path

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/wasm", ".wasm")


def serve_ui(request, path: str = ""):
    root = settings.DESKTOP_UI_ROOT.resolve()
    target = (root / path).resolve()
    if path and target.is_file():
        if root not in target.parents:
            raise Http404()
        response = FileResponse(open(target, "rb"))
        # bundles have content hashes in their names
        response["Cache-Control"] = "public, max-age=31536000, immutable"
        return response

    # client-side routing: unknown paths get the SPA entry point
    response = FileResponse(open(root / "index.html", "rb"), content_type="text/html")
    response["Cache-Control"] = "no-cache"
    return response


urlpatterns = [
    re_path(r"^(?!api/|admin/|django-rq/|static/)(?P<path>.*)$", serve_ui),
]
