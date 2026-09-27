# Copyright (C) 2018-2022 Intel Corporation
#
# SPDX-License-Identifier: MIT

"""CVAT URL Configuration

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/2.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""

from django.apps import apps
from django.conf import settings
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("", include("cvat.apps.engine.urls")),
    path("", include("cvat.apps.redis_handler.urls")),
    path("django-rq/", include("django_rq.urls")),
]

if apps.is_installed("cvat.apps.log_viewer"):
    urlpatterns.append(path("", include("cvat.apps.log_viewer.urls")))

if apps.is_installed("cvat.apps.events"):
    urlpatterns.append(path("api/", include("cvat.apps.events.urls")))

# Desktop build has no serverless (Nuclio) backend; a 404 tells the UI there are no models.
if apps.is_installed("cvat.apps.lambda_manager") and not getattr(settings, "DESKTOP_MODE", False):
    urlpatterns.append(path("", include("cvat.apps.lambda_manager.urls")))

if apps.is_installed("cvat.apps.webhooks"):
    urlpatterns.append(path("api/", include("cvat.apps.webhooks.urls")))

if apps.is_installed("cvat.apps.quality_control"):
    urlpatterns.append(path("api/", include("cvat.apps.quality_control.urls")))

if apps.is_installed("silk"):
    urlpatterns.append(path("profiler/", include("silk.urls")))

if apps.is_installed("health_check"):
    urlpatterns.append(path("api/server/health/", include("health_check.urls")))

if apps.is_installed("cvat.apps.consensus"):
    urlpatterns.append(path("api/", include("cvat.apps.consensus.urls")))

if apps.is_installed("cvat.apps.access_tokens"):
    urlpatterns.append(path("api/", include("cvat.apps.access_tokens.urls")))

if apps.is_installed("cvat.apps.growth"):
    urlpatterns.append(path("api/", include("cvat.apps.growth.urls")))

# Desktop build: Django serves the UI. The root must come before the engine's
# legacy "" redirect, the catch-all must stay last.
if getattr(settings, "DESKTOP_MODE", False) and settings.DESKTOP_UI_ROOT:
    from django.urls import re_path
    from django.views.static import serve as serve_static

    from cvat.desktop.ui import serve_ui

    urlpatterns.insert(0, path("", serve_ui))
    urlpatterns.append(
        re_path(r"^static/(?P<path>.*)$", serve_static, {"document_root": settings.STATIC_ROOT})
    )
    urlpatterns.append(path("", include("cvat.desktop.ui")))
