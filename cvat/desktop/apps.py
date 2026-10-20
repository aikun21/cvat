# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

from django.apps import AppConfig


class DesktopConfig(AppConfig):
    name = "cvat.desktop"
    label = "cvat_desktop"

    def ready(self) -> None:
        from . import cache_cleanup

        cache_cleanup.connect()
