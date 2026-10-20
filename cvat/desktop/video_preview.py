# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

# Browser-playable previews of local videos for the "split video" dialog of the task
# creation page. Chromium cannot play some containers and codecs (e.g. MPEG-TS, HEVC),
# so such a file is uploaded here and converted to MP4:
#   - H.264 video is only remuxed (fast, no quality loss),
#   - other codecs are transcoded to a small H.264 video.
# Only the video stream is kept. The first frame of the preview is at time 0, so the dialog
# maps time to frame numbers with the returned frame rate, which is the same rate as
# in task data/meta (see get_video_fps).
#
# Conversion runs in a background thread: Django runs sync views in a single thread under
# ASGI, a long request would block the whole API. The client polls the status.

import json
import shutil
import threading
import time
import uuid
from fractions import Fraction
from pathlib import Path

import av
from django.conf import settings
from django.http import FileResponse, Http404, HttpResponse, JsonResponse
from django.urls import path
from django.views.decorators.http import require_GET, require_POST

PREVIEW_MAX_WIDTH = 960
PREVIEW_RETENTION_SECONDS = 24 * 60 * 60
RANGE_CHUNK_SIZE = 8 * 1024 * 1024
COPY_BUFFER_SIZE = 4 * 1024 * 1024


def _root() -> Path:
    return Path(settings.TMP_FILES_ROOT) / "video-preview"


def _preview_dir(preview_id: str) -> Path:
    try:
        uuid.UUID(preview_id)
    except ValueError:
        raise Http404()
    directory = _root() / preview_id
    if not directory.is_dir():
        raise Http404()
    return directory


def _write_status(directory: Path, **status) -> None:
    tmp = directory / "status.json.tmp"
    tmp.write_text(json.dumps(status))
    tmp.replace(directory / "status.json")


def _video_rate(stream) -> Fraction:
    rate = stream.average_rate or stream.guessed_rate
    if not rate or rate <= 0:
        return Fraction(25)
    return Fraction(rate).limit_denominator(1001)


def _remux(source: Path, target: Path, report) -> int:
    frames = 0
    with av.open(str(source)) as input_container, av.open(str(target), "w", format="mp4") as output:
        input_stream = input_container.streams.video[0]
        output_stream = output.add_stream_from_template(input_stream)
        size = source.stat().st_size
        offset = None
        for packet in input_container.demux(input_stream):
            if packet.pts is None or packet.dts is None or not packet.size:
                continue
            if offset is None:
                # frames before the first key frame can't be decoded
                if not packet.is_keyframe:
                    continue
                offset = packet.pts
            packet.pts -= offset
            packet.dts -= offset
            packet.stream = output_stream
            output.mux(packet)
            frames += 1
            if packet.pos and frames % 100 == 0:
                report(packet.pos / size)
    return frames


def _transcode(source: Path, target: Path, rate: Fraction, report) -> int:
    frames = 0
    with av.open(str(source)) as input_container, av.open(str(target), "w", format="mp4") as output:
        input_stream = input_container.streams.video[0]
        input_stream.thread_type = "AUTO"
        expected = input_stream.frames or (
            float(input_stream.duration * input_stream.time_base * rate)
            if input_stream.duration
            else 0
        )

        width = input_stream.codec_context.width
        height = input_stream.codec_context.height
        if width > PREVIEW_MAX_WIDTH:
            height = round(height * PREVIEW_MAX_WIDTH / width)
            width = PREVIEW_MAX_WIDTH
        width -= width % 2
        height -= height % 2

        output_stream = output.add_stream("libx264", rate=rate)
        output_stream.width = width
        output_stream.height = height
        output_stream.pix_fmt = "yuv420p"
        # a key frame every second keeps seeking fast
        output_stream.options = {"preset": "ultrafast", "crf": "28", "g": str(max(1, round(rate)))}

        for frame in input_container.decode(input_stream):
            image = frame.reformat(width=width, height=height, format="yuv420p")
            # frame N is shown at N / rate
            image.pts = frames
            image.time_base = 1 / rate
            for packet in output_stream.encode(image):
                output.mux(packet)
            frames += 1
            if expected and frames % 25 == 0:
                report(frames / expected)
        for packet in output_stream.encode():
            output.mux(packet)
    return frames


def _convert(directory: Path) -> None:
    source = directory / "source"
    target = directory / "preview.mp4"
    started = time.monotonic()
    last_report = 0.0

    def report(progress: float) -> None:
        nonlocal last_report
        now = time.monotonic()
        if now - last_report >= 0.5:
            last_report = now
            _write_status(directory, status="processing", progress=min(progress, 0.99))

    try:
        with av.open(str(source)) as container:
            if not container.streams.video:
                raise ValueError("The file has no video stream")
            stream = container.streams.video[0]
            rate = _video_rate(stream)
            codec = stream.codec_context.name

        frames = 0
        if codec == "h264":
            try:
                frames = _remux(source, target, report)
            except Exception:
                target.unlink(missing_ok=True)
                frames = 0
        if not frames:
            frames = _transcode(source, target, rate, report)
        if not frames:
            raise ValueError("No frames were found in the video")

        _write_status(
            directory,
            status="done",
            fps=float(rate),
            frames=frames,
            elapsed=round(time.monotonic() - started, 2),
        )
    except Exception as ex:
        target.unlink(missing_ok=True)
        _write_status(directory, status="failed", error=str(ex))
    finally:
        source.unlink(missing_ok=True)


def _remove_outdated() -> None:
    root = _root()
    if not root.is_dir():
        return
    now = time.time()
    for directory in root.iterdir():
        try:
            if now - directory.stat().st_mtime > PREVIEW_RETENTION_SECONDS:
                shutil.rmtree(directory, ignore_errors=True)
        except OSError:
            pass


def _require_user(request) -> HttpResponse | None:
    if not request.user.is_authenticated:
        return JsonResponse({"detail": "Authentication required"}, status=401)
    return None


@require_POST
def create_preview(request):
    if error := _require_user(request):
        return error

    _remove_outdated()
    preview_id = str(uuid.uuid4())
    directory = _root() / preview_id
    directory.mkdir(parents=True)
    # the body is a raw video file, ASGI has already buffered it in a temporary file
    with open(directory / "source", "wb") as source:
        shutil.copyfileobj(request, source, COPY_BUFFER_SIZE)
    _write_status(directory, status="processing", progress=0)

    threading.Thread(target=_convert, args=(directory,), daemon=True).start()
    return JsonResponse({"id": preview_id}, status=202)


@require_GET
def preview_status(request, preview_id: str):
    if error := _require_user(request):
        return error

    directory = _preview_dir(preview_id)
    return JsonResponse(json.loads((directory / "status.json").read_text()))


@require_GET
def preview_video(request, preview_id: str):
    if error := _require_user(request):
        return error

    video = _preview_dir(preview_id) / "preview.mp4"
    if not video.is_file():
        raise Http404()
    size = video.stat().st_size
    headers = {"Accept-Ranges": "bytes", "Cache-Control": "no-store"}

    requested = request.headers.get("Range", "")
    if not requested.startswith("bytes="):
        return FileResponse(open(video, "rb"), content_type="video/mp4", headers=headers)

    first, _, last = requested[len("bytes=") :].split(",")[0].strip().partition("-")
    try:
        if first:
            start = int(first)
            end = int(last) if last else size - 1
        else:
            start = max(0, size - int(last))
            end = size - 1
    except ValueError:
        start, end = 0, size - 1
    if start >= size or end < start:
        return HttpResponse(status=416, headers={**headers, "Content-Range": f"bytes */{size}"})
    # open-ended requests are answered in parts, the player asks for the rest
    end = min(end, size - 1, start + RANGE_CHUNK_SIZE - 1)

    with open(video, "rb") as file:
        file.seek(start)
        data = file.read(end - start + 1)

    return HttpResponse(
        data,
        status=206,
        content_type="video/mp4",
        headers={**headers, "Content-Range": f"bytes {start}-{end}/{size}"},
    )


urlpatterns = [
    path("video-preview", create_preview),
    path("video-preview/<str:preview_id>", preview_status),
    path("video-preview/<str:preview_id>/video", preview_video),
]
