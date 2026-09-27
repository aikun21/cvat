# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

# Automatic login for the desktop build. The Electron shell generates a random token
# on every launch, passes it to the server via the CVAT_DESKTOP_TOKEN environment variable
# and adds it to every request of its own window. Such requests get a session of the
# local desktop user, so there is no login screen. Requests without the token (e.g. from
# a regular browser) are handled as usual.

import hmac

from django.conf import settings
from django.contrib.auth import get_user_model, login


class DesktopAutoLoginMiddleware:
    HEADER = "HTTP_X_CVAT_DESKTOP_TOKEN"

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        expected = settings.DESKTOP_TOKEN
        token = request.META.get(self.HEADER)
        if (
            expected
            and token
            and not request.user.is_authenticated
            and hmac.compare_digest(token.encode(), expected.encode())
        ):
            user = get_user_model().objects.filter(username=settings.DESKTOP_USERNAME).first()
            if user is not None and user.is_active:
                login(request, user, backend="django.contrib.auth.backends.ModelBackend")

        return self.get_response(request)
