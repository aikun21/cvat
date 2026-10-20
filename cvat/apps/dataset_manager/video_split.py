# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

# Dataset export with video splitting: the video of each task is cut into clips of a fixed
# duration and every clip is exported on its own, as if it was a separate video:
#
#   <clip name>/
#       <clip name>.mp4
#       <files of the selected format>
#
# Frame numbers in the exported annotations are relative to the clip.

from __future__ import annotations

import itertools
import json
import os
import os.path as osp
import re
import shutil
import zipfile
from collections.abc import Callable, Iterator
from contextlib import nullcontext
from dataclasses import dataclass
from fractions import Fraction
from pathlib import PurePath

import av
import rq
from django.db import transaction

from cvat.apps.engine import models
from cvat.apps.engine.media_extractors import VideoReader, get_video_fps
from cvat.apps.engine.rq import ExportRQMeta

from .annotation import AnnotationIR
from .bindings import CvatExportError, TaskData
from .task import JobAnnotation, TaskAnnotation
from .util import TmpDirManager

MIN_SPLIT_SECONDS = 1
MAX_SPLIT_SECONDS = 3600

_CLIP_EXT = ".mp4"
_STORED_EXTENSIONS = {".mp4", ".jpg", ".jpeg", ".png", ".zip"}
_INDEX_FILENAME = "segments.json"


class ClipData(TaskData):
    """
    Represents a frame range of a video task as a standalone video.

    Internal (relative) frame ids are the same as in the task, so annotations and media
    are addressed as usual. Exported (absolute) frame ids are counted from the clip start.
    """

    def __init__(
        self,
        annotation_ir: AnnotationIR,
        db_task: models.Task,
        *,
        start: int,
        stop: int,
        name: str,
        source: str,
        **kwargs,
    ):
        self._clip_start = start
        self._clip_stop = stop
        self._clip_name = name
        self._clip_source = source

        super().__init__(annotation_ir, db_task, **kwargs)

        # the clip contains only the task frames, there is nothing between them
        self._frame_step = 1

    def __len__(self):
        return self._clip_stop - self._clip_start + 1

    @property
    def rel_range(self):
        return range(self._clip_start, self._clip_stop + 1)

    @property
    def start(self) -> int:
        return self._clip_start

    @property
    def stop(self) -> int:
        return self._clip_stop

    def _abs_frame_id(self, relative_id, *, allow_after_range: bool = False):
        if relative_id not in self.rel_range and not (
            allow_after_range and relative_id == self.rel_range.stop
        ):
            raise ValueError("Unknown internal frame id %s" % relative_id)
        return relative_id - self._clip_start

    def _rel_frame_id(self, absolute_id, *, allow_after_range: bool = False):
        relative_id = absolute_id + self._clip_start
        if relative_id not in self.rel_range and not (
            allow_after_range and relative_id == self.rel_range.stop
        ):
            raise ValueError("Unknown frame %s" % absolute_id)
        return relative_id

    def _init_meta(self):
        super()._init_meta()

        meta = self._meta[self.META_FIELD]
        last_frame = str(len(self) - 1)
        meta.update(
            {
                "name": self._clip_name,
                "size": str(len(self)),
                "start_frame": "0",
                "stop_frame": last_frame,
                "frame_filter": "",
                "source": self._clip_source,
                "segments": [
                    (
                        "segment",
                        {
                            "id": "0",
                            "start": "0",
                            "stop": last_frame,
                            "url": "{}/api/tasks/{}".format(self._host, self._db_task.id),
                        },
                    ),
                ],
            }
        )


@dataclass(frozen=True)
class _Clip:
    name: str
    start: int  # the first frame of the clip, relative to the task
    stop: int  # the last frame of the clip, relative to the task


def _make_file_name(name: str, default: str) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .")
    return name or default


def _make_clips(base_name: str, start: int, stop: int, frames_per_clip: int) -> list[_Clip]:
    starts = range(start, stop + 1, frames_per_clip)
    digits = max(3, len(str(len(starts))))
    return [
        _Clip(
            name=f"{base_name}_{index:0{digits}d}",
            start=clip_start,
            stop=min(clip_start + frames_per_clip - 1, stop),
        )
        for index, clip_start in enumerate(starts, start=1)
    ]


def _add_video_stream(
    container: av.container.OutputContainer, *, width: int, height: int, fps: Fraction
) -> av.VideoStream:
    try:
        stream = container.add_stream("libx264", rate=fps)
        stream.options = {"crf": "12", "preset": "veryfast"}
    except av.codec.codec.UnknownCodecError:
        stream = container.add_stream("libopenh264", rate=fps)
        stream.codec_context.qmin = stream.codec_context.qmax = 12

    stream.pix_fmt = "yuv420p"
    # yuv420p requires even frame sizes
    stream.width = width + width % 2
    stream.height = height + height % 2
    stream.codec_context.time_base = 1 / fps
    return stream


def _write_clip(
    frames: Iterator[tuple[av.VideoFrame, None]], path: str, *, fps: Fraction
) -> int:
    frame_count = 0
    with av.open(path, "w", format="mp4") as container:
        stream = None
        for frame, _ in frames:
            if stream is None:
                stream = _add_video_stream(
                    container, width=frame.width, height=frame.height, fps=fps
                )

            # the encoder must choose frame types and timestamps itself
            frame.pict_type = av.video.frame.PictureType.NONE
            frame.pts = frame_count
            frame.time_base = stream.codec_context.time_base

            for packet in stream.encode(frame):
                container.mux(packet)

            frame_count += 1

        if stream is not None:
            for packet in stream.encode():
                container.mux(packet)

    return frame_count


def _write_clip_videos(
    db_data: models.Data,
    clips: list[_Clip],
    paths: list[str],
    *,
    fps: Fraction,
    on_clip_written: Callable[[], None],
) -> None:
    step = db_data.get_frame_step()
    reader = VideoReader(
        [db_data.get_openable(db_data.video.path)],
        step=step,
        start=db_data.start_frame + clips[0].start * step,
        stop=db_data.start_frame + clips[-1].stop * step,
        allow_threading=True,
    )

    # the video is decoded only once, clips are taken from the same iterator one after another
    frames = iter(reader)
    try:
        for clip, path in zip(clips, paths):
            expected = clip.stop - clip.start + 1
            written = _write_clip(itertools.islice(frames, expected), path, fps=fps)
            if written != expected:
                raise CvatExportError(
                    f"Could not read frames {clip.start + written}-{clip.stop} of the video "
                    f"'{db_data.video.path}'"
                )
            on_clip_written()
    finally:
        frames.close()


def _keep_frames_inside(track: dict, start: int, stop: int) -> None:
    track["shapes"] = [shape for shape in track["shapes"] if start <= shape["frame"] <= stop]
    for element in track.get("elements", []):
        _keep_frames_inside(element, start, stop)


def _slice_annotations(annotation_ir: AnnotationIR, clip: _Clip) -> AnnotationIR:
    clip_ir = annotation_ir.slice(clip.start, clip.stop)
    for track in clip_ir.tracks:
        _keep_frames_inside(track, clip.start, clip.stop)
    clip_ir.tracks = [
        track
        for track in clip_ir.tracks
        if track["shapes"] or any(element["shapes"] for element in track.get("elements", []))
    ]
    return clip_ir


def _run_exporter(
    exporter: Callable[..., None],
    instance_data: TaskData,
    dst_dir: str,
    *,
    work_dir: str,
    save_images: bool,
) -> None:
    os.makedirs(dst_dir, exist_ok=True)

    exporter_dir = osp.join(work_dir, "exporter")
    result_file = osp.join(work_dir, "result")
    os.makedirs(exporter_dir)
    try:
        with open(result_file, "wb") as f:
            exporter(f, exporter_dir, instance_data, save_images=save_images)

        if zipfile.is_zipfile(result_file):
            with zipfile.ZipFile(result_file) as archive:
                archive.extractall(dst_dir)
        else:
            shutil.move(result_file, osp.join(dst_dir, "annotations." + exporter.EXT.lower()))
    finally:
        shutil.rmtree(exporter_dir, ignore_errors=True)
        if osp.exists(result_file):
            os.remove(result_file)


class _Progress:
    def __init__(self) -> None:
        self._rq_job = rq.get_current_job()
        self._total = 0
        self._done = 0

    def add_total(self, count: int) -> None:
        self._total += count

    def advance(self) -> None:
        self._done += 1
        if self._rq_job and self._total:
            meta = ExportRQMeta.for_job(self._rq_job)
            meta.progress = min(self._done / self._total, 1.0)
            meta.save()


def _export_task(
    db_task: models.Task,
    annotation_ir: AnnotationIR,
    dst_dir: str,
    *,
    frame_range: tuple[int, int],
    split_seconds: int,
    exporter: Callable[..., None],
    server_url: str | None,
    save_images: bool,
    work_dir: str,
    progress: _Progress,
) -> dict:
    db_data = db_task.data
    start, stop = frame_range

    fps = get_video_fps(db_data.get_openable(db_data.video.path)) / db_data.get_frame_step()
    frames_per_clip = max(1, round(split_seconds * fps))
    source = PurePath(db_data.video.path).name
    clips = _make_clips(
        _make_file_name(PurePath(source).stem, default=f"task_{db_task.id}"),
        start,
        stop,
        frames_per_clip,
    )

    # each clip is counted twice: the video and the annotations
    progress.add_total(len(clips) * 2)

    clip_dirs = [osp.join(dst_dir, clip.name) for clip in clips]
    for clip_dir in clip_dirs:
        os.makedirs(clip_dir, exist_ok=True)

    _write_clip_videos(
        db_data,
        clips,
        [osp.join(clip_dir, clip.name + _CLIP_EXT) for clip, clip_dir in zip(clips, clip_dirs)],
        fps=fps,
        on_clip_written=progress.advance,
    )

    for clip, clip_dir in zip(clips, clip_dirs):
        clip_data = ClipData(
            _slice_annotations(annotation_ir, clip),
            db_task,
            start=clip.start,
            stop=clip.stop,
            name=clip.name,
            source=clip.name + _CLIP_EXT,
            host=server_url or "",
        )
        _run_exporter(exporter, clip_data, clip_dir, work_dir=work_dir, save_images=save_images)
        progress.advance()

    return {
        "task_id": db_task.id,
        "task_name": db_task.name,
        "source": source,
        "fps": float(fps),
        "clips": [
            {
                "dir": clip.name,
                "video": clip.name + _CLIP_EXT,
                "start_frame": clip.start,
                "stop_frame": clip.stop,
                "frames": clip.stop - clip.start + 1,
                "start_time": round(float(clip.start / fps), 3),
                "end_time": round(float((clip.stop + 1) / fps), 3),
            }
            for clip in clips
        ],
    }


def _is_video_task(db_task: models.Task) -> bool:
    return hasattr(db_task.data, "video")


def _make_archive(src_dir: str, dst_file: str) -> None:
    with zipfile.ZipFile(dst_file, "w") as archive:
        for dirpath, _, filenames in os.walk(src_dir):
            for filename in filenames:
                path = osp.join(dirpath, filename)
                # media files are already compressed
                is_stored = osp.splitext(filename)[1].lower() in _STORED_EXTENSIONS
                archive.write(
                    path,
                    osp.relpath(path, src_dir),
                    compress_type=zipfile.ZIP_STORED if is_stored else zipfile.ZIP_DEFLATED,
                )


def _load_targets(
    db_instance: models.Project | models.Task | models.Job,
) -> list[tuple[models.Task, AnnotationIR, tuple[int, int], str]]:
    """
    Returns (task, annotations, frame range, directory inside the archive) for each task
    """

    if isinstance(db_instance, models.Job):
        db_segment = db_instance.segment
        db_task = db_segment.task
        if not _is_video_task(db_task) or db_segment.type != models.SegmentType.RANGE:
            raise CvatExportError("Video splitting is available only for video jobs")

        annotation = JobAnnotation(db_instance.id)
        annotation.init_from_db()
        return [(db_task, annotation.ir_data, (db_segment.start_frame, db_segment.stop_frame), "")]

    if isinstance(db_instance, models.Project):
        db_tasks = list(
            models.Task.objects.filter(project=db_instance).exclude(data=None).order_by("id")
        )
    else:
        db_tasks = [db_instance]
        if not _is_video_task(db_instance):
            raise CvatExportError("Video splitting is available only for video tasks")

    used_dirs: set[str] = set()
    targets = []
    for db_task in db_tasks:
        task_dir = ""
        if isinstance(db_instance, models.Project):
            task_dir = _make_file_name(db_task.name, default=f"task_{db_task.id}")
            if task_dir.lower() in used_dirs:
                task_dir += f"_{db_task.id}"
            used_dirs.add(task_dir.lower())

        annotation = TaskAnnotation(db_task.id)
        annotation.init_from_db()
        targets.append((db_task, annotation.ir_data, (0, db_task.data.size - 1), task_dir))

    return targets


def export_with_video_split(
    db_instance: models.Project | models.Task | models.Job,
    dst_file: str,
    *,
    format_name: str,
    split_seconds: int,
    server_url: str | None = None,
    save_images: bool = False,
    temp_dir: str | None = None,
) -> None:
    from .formats.registry import make_exporter

    assert MIN_SPLIT_SECONDS <= split_seconds <= MAX_SPLIT_SECONDS

    exporter = make_exporter(format_name)
    progress = _Progress()

    # Only reading of the annotations is done in a transaction:
    # video encoding takes long, and the database must not stay locked all that time.
    with transaction.atomic():
        targets = _load_targets(db_instance)

    with (
        TmpDirManager.get_tmp_directory() if not temp_dir else nullcontext(temp_dir)
    ) as temp_dir:
        out_dir = osp.join(temp_dir, "out")
        work_dir = osp.join(temp_dir, "work")
        os.makedirs(out_dir)
        os.makedirs(work_dir)

        index = {"format": format_name, "split_seconds": split_seconds, "videos": []}
        for db_task, annotation_ir, frame_range, task_dir in targets:
            dst_dir = osp.join(out_dir, task_dir)

            if not _is_video_task(db_task):
                # tasks made of images cannot be split, they are exported as is
                _run_exporter(
                    exporter,
                    TaskData(annotation_ir, db_task, host=server_url or ""),
                    dst_dir,
                    work_dir=work_dir,
                    save_images=save_images,
                )
                continue

            index["videos"].append(
                {
                    "dir": task_dir,
                    **_export_task(
                        db_task,
                        annotation_ir,
                        dst_dir,
                        frame_range=frame_range,
                        split_seconds=split_seconds,
                        exporter=exporter,
                        server_url=server_url,
                        save_images=save_images,
                        work_dir=work_dir,
                        progress=progress,
                    ),
                }
            )

        with open(osp.join(out_dir, _INDEX_FILENAME), "w", encoding="utf-8") as f:
            json.dump(index, f, ensure_ascii=False, indent=2)

        _make_archive(out_dir, dst_file)
