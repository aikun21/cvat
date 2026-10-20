# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

# In the desktop build video chunks are kept in the on-disk media cache until their task is
# deleted (see CACHES["media"] in cvat/settings/desktop.py), so they are prepared only once.
# The file cache can't remove entries by prefix, this module removes the entries of a task
# when the task is deleted.

import math

from django.db.models.signals import pre_delete

from cvat.apps.engine import models
from cvat.apps.engine.cache import MediaCache
from cvat.apps.engine.log import ServerLogManager

slogger = ServerLogManager(__name__)

_QUALITIES = (models.FrameQuality.COMPRESSED, models.FrameQuality.ORIGINAL)


def _make_task_cache_keys(db_task: models.Task) -> list[str]:
    db_data = db_task.data
    if not db_data or not db_data.chunk_size:
        return []

    def chunk_count(frame_count: int) -> int:
        return math.ceil(frame_count / db_data.chunk_size)

    media_cache = MediaCache()
    keys = [
        media_cache._make_chunk_key(db_task, chunk, quality=quality)
        for chunk in range(chunk_count(db_data.size))
        for quality in _QUALITIES
    ]

    for db_segment in db_task.segment_set.prefetch_related("job_set"):
        keys.append(media_cache._make_preview_key(db_segment))
        for chunk in range(chunk_count(db_segment.frame_count)):
            for quality in _QUALITIES:
                keys.append(media_cache._make_chunk_key(db_segment, chunk, quality=quality))
                keys.append(
                    media_cache._make_segment_task_chunk_key(db_segment, chunk, quality=quality)
                )
                keys.extend(
                    media_cache._make_chunk_key(db_job, chunk, quality=quality)
                    for db_job in db_segment.job_set.all()
                )

    return keys


def _remove_task_cache(sender, instance: models.Task, **kwargs) -> None:
    try:
        keys = _make_task_cache_keys(instance)
        MediaCache._cache().delete_many(keys)
    except Exception:  # never prevent the deletion of the task
        slogger.glob.warning(f"Failed to remove cached chunks of task {instance.id}", exc_info=True)


def connect() -> None:
    pre_delete.connect(_remove_task_cache, sender=models.Task, dispatch_uid=__name__)
