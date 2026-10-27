# Copyright (C) CVAT.ai Corporation
#
# SPDX-License-Identifier: MIT

# "Import annotated data" on the projects page: creates a new project from a zip archive.
#
#   - A project backup (project.json at the root) is restored as is.
#   - Videos with annotation files: every video becomes a video task, the annotations next to it
#     are imported into the task. The annotations of a video are all other files of its directory
#     when it is the only video there (this is how datasets exported with video splitting are laid
#     out: one directory per clip), otherwise the files and the directory named after the video.
#   - Otherwise the archive is a dataset with images, it is imported as CVAT imports datasets
#     into projects: one image task per subset.
#
# Labels and attributes the annotations refer to are created in the project.
# The import runs in the "import" queue, the client polls the status.

from __future__ import annotations

import json
import re
import shutil
import traceback
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

import django_rq
import rq
from django.conf import settings
from django.db import transaction
from django.http import Http404, JsonResponse
from django.urls import path
from django.views.decorators.http import require_GET, require_POST

from cvat.apps.dataset_manager.annotation import AnnotationIR
from cvat.apps.dataset_manager.bindings import CvatImportError, TaskData
from cvat.apps.dataset_manager.formats.registry import IMPORT_FORMATS, make_importer
from cvat.apps.dataset_manager.project import import_dataset_as_project
from cvat.apps.dataset_manager.task import TaskAnnotation
from cvat.apps.dataset_manager.util import TmpDirManager, format_import_exception
from cvat.apps.engine import backup, models
from cvat.apps.engine.label_colors import get_label_color
from cvat.apps.engine.serializers import DataSerializer, ProjectWriteSerializer, TaskWriteSerializer
from cvat.apps.engine.task import initialize_task

AUTO_FORMAT = "auto"
JOB_ID_PREFIX = "desktop-project-import-"
JOB_TIMEOUT = 24 * 60 * 60
COPY_BUFFER_SIZE = 4 * 1024 * 1024

VIDEO_EXTENSIONS = {
    ".3gp", ".avi", ".flv", ".m2ts", ".m4v", ".mkv", ".mov", ".mp4",
    ".mpeg", ".mpg", ".mts", ".ts", ".webm", ".wmv",
}  # fmt: skip

# the index written by the dataset export with video splitting (dataset_manager/video_split.py)
SEGMENTS_INDEX = "segments.json"

# meta of the rq job, read by the status request
META_STAGE = "desktop_import_stage"
META_ERROR = "desktop_import_error"


def _root() -> Path:
    return Path(settings.TMP_FILES_ROOT) / "project-import"


@dataclass
class _VideoUnit:
    video: Path
    # annotation files and their paths in the archive given to the importer
    files: list[tuple[Path, str]] = field(default_factory=list)
    # name of the task
    name: str = ""


def _set_stage(stage: str, **details) -> None:
    job = rq.get_current_job()
    job.meta[META_STAGE] = {"stage": stage, **details}
    job.meta["status"] = ""
    job.meta["progress"] = None
    job.save_meta()


def _decode_zip_name(info: zipfile.ZipInfo) -> str:
    # archives made on Windows store names in the local code page without the utf-8 flag,
    # zipfile reads them as cp437
    if info.flag_bits & 0x800:
        return info.filename
    raw = info.filename.encode("cp437")
    for encoding in ("utf-8", "gbk"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return info.filename


def _extract(archive: Path, target: Path) -> None:
    target_root = target.resolve()
    with zipfile.ZipFile(archive) as zf:
        for info in zf.infolist():
            name = _decode_zip_name(info)
            destination = (target / name).resolve()
            if not destination.is_relative_to(target_root):
                raise CvatImportError(f"Unsafe path in the archive: {name}")
            if info.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info) as src, open(destination, "wb") as dst:
                shutil.copyfileobj(src, dst, COPY_BUFFER_SIZE)


def _natural_key(value: Path) -> list:
    parts = re.split(r"(\d+)", str(value))
    return [int(part) if part.isdigit() else part.lower() for part in parts]


def _find_video_units(root: Path) -> list[_VideoUnit]:
    videos = sorted(
        (p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in VIDEO_EXTENSIONS),
        key=_natural_key,
    )
    videos_by_dir: dict[Path, list[Path]] = {}
    for video in videos:
        videos_by_dir.setdefault(video.parent, []).append(video)

    def belongs_to_other_videos(file: Path, directory: Path) -> bool:
        # a file inside a subdirectory with its own videos belongs to those videos
        parent = file.parent
        while parent != directory:
            if parent in videos_by_dir:
                return True
            parent = parent.parent
        return False

    def files_under(directory: Path, owner_dir: Path) -> list[Path]:
        return [
            p
            for p in sorted(directory.rglob("*"))
            if p.is_file()
            and p.suffix.lower() not in VIDEO_EXTENSIONS
            and not belongs_to_other_videos(p, owner_dir)
        ]

    units = []
    for directory, dir_videos in videos_by_dir.items():
        if len(dir_videos) == 1:
            files = files_under(directory, directory)
            units.append(
                _VideoUnit(
                    dir_videos[0],
                    [(f, f.relative_to(directory).as_posix()) for f in files],
                )
            )
            continue

        for video in dir_videos:
            unit = _VideoUnit(video)
            for sibling in sorted(directory.iterdir()):
                if sibling.is_file() and sibling != video and sibling.stem == video.stem:
                    if sibling.suffix.lower() not in VIDEO_EXTENSIONS:
                        unit.files.append((sibling, sibling.name))
            own_dir = directory / video.stem
            if own_dir.is_dir():
                unit.files += [
                    (f, f.relative_to(own_dir).as_posix()) for f in files_under(own_dir, own_dir)
                ]
            units.append(unit)

    # tasks are named after the videos; when videos in different directories have the same name
    # (e.g. clips of different tasks in a dataset exported with video splitting),
    # all tasks are named after the paths of the videos: "task/clip"
    stems = [unit.video.stem for unit in units]
    use_paths = len(set(stems)) != len(stems)
    for unit in units:
        parts = list(unit.video.relative_to(root).with_suffix("").parts)
        if len(parts) > 1 and parts[-2] == parts[-1]:
            parts.pop()
        unit.name = "/".join(parts) if use_paths else unit.video.stem

    return sorted(units, key=lambda u: _natural_key(u.video))


def _importer_name(format_name: str) -> str | None:
    # export and import formats differ in a few names
    if format_name in IMPORT_FORMATS:
        return format_name
    if match := re.fullmatch(r"CVAT for (images|video) (\S+)", format_name):
        return f"CVAT {match.group(2)}"
    if format_name == "Ultralytics YOLO Detection Track 1.0":
        return "Ultralytics YOLO Detection 1.0"
    return None


def _detect_format(files: list[Path]) -> str | None:
    names = {f.name.lower() for f in files}
    for f in files:
        if f.suffix.lower() == ".xml":
            with open(f, "rb") as xml:
                head = xml.read(4096)
            if b"<annotations" in head:
                return "CVAT 1.1"
            if b"<annotation" in head:
                return "PASCAL VOC 1.1"
    if "gt.txt" in names:
        return "MOT 1.1"
    if "data.yaml" in names:
        return "Ultralytics YOLO Detection 1.0"
    if "obj.data" in names:
        return "YOLO 1.1"
    for f in files:
        if f.suffix.lower() == ".json" and f.name != SEGMENTS_INDEX:
            # the lists of images and annotations can be long, the keys are in the first megabyte
            with open(f, "rb") as data:
                head = data.read(1024 * 1024)
            if b'"images"' in head and b'"categories"' in head:
                return "COCO 1.0"
            if b'"items"' in head and b'"categories"' in head:
                return "Datumaro 1.0"
    return None


def _resolve_format(requested: str, data_dir: Path, files: list[Path]) -> str:
    if requested != AUTO_FORMAT:
        if requested not in IMPORT_FORMATS:
            raise CvatImportError(f"Unknown annotation format: {requested}")
        return requested

    index = data_dir / SEGMENTS_INDEX
    if index.is_file():
        exported = json.loads(index.read_text(encoding="utf-8")).get("format", "")
        if name := _importer_name(exported):
            return name

    if name := _detect_format(files):
        return name
    raise CvatImportError("The annotation format is not recognized, choose it manually")


def _create_project(name: str, user_id: int) -> models.Project:
    return ProjectWriteSerializer.create(None, {"name": name, "owner_id": user_id, "label_set": []})


@transaction.atomic
def _create_video_task(db_project: models.Project, unit: _VideoUnit) -> models.Task:
    # the same data parameters as the task creation page of the desktop build
    data_serializer = DataSerializer(
        data={
            "server_files": [unit.video.name],
            "use_cache": True,
            "use_zip_chunks": False,
            "image_quality": 70,
        }
    )
    data_serializer.is_valid(raise_exception=True)
    db_data = data_serializer.save()
    db_data.storage_method = models.StorageMethodChoice.CACHE
    db_data.save(update_fields=["storage_method"])

    db_task = TaskWriteSerializer.create(
        None,
        {
            "name": unit.name,
            "owner_id": db_project.owner_id,
            "data_id": db_data.id,
            "project_id": db_project.id,
        },
    )

    data = dict(data_serializer.data)
    data["use_zip_chunks"] = False
    data["use_cache"] = True
    data["copy_data"] = data_serializer.validated_data["copy_data"]
    # the video is copied from the extracted archive into the task data
    data["server_files_path"] = str(unit.video.parent) + "/"
    data["stop_frame"] = None
    initialize_task(db_task=db_task, data=data)
    return models.Task.objects.get(pk=db_task.pk)


class _LabelCreatingTaskData(TaskData):
    """Task data that adds the labels the imported annotations refer to into the project."""

    def _get_label_id(self, label_name, parent_id=None):
        try:
            return super()._get_label_id(label_name, parent_id)
        except ValueError:
            # skeleton points need a skeleton definition, they are not created
            if parent_id is not None:
                raise

        db_label = models.Label.objects.create(
            project_id=self._db_task.project_id,
            name=label_name,
            color=get_label_color(label_name, [l.color for l in self._label_mapping.values()]),
            type=models.LabelType.ANY,
        )
        self._label_mapping[db_label.id] = db_label
        self._attribute_mapping[db_label.id] = {"mutable": {}, "immutable": {}, "spec": {}}
        self._attribute_mapping_merged[db_label.id] = {}
        return db_label.id


@transaction.atomic
def _import_task_annotations(db_task: models.Task, archive: Path, format_name: str) -> None:
    task_annotation = TaskAnnotation(db_task.id, write_only=True)
    task_data = _LabelCreatingTaskData(
        annotation_ir=AnnotationIR(db_task.dimension),
        db_task=db_task,
        create_callback=task_annotation.create,
    )
    task_data.soft_attribute_import = True

    importer = make_importer(format_name)
    with TmpDirManager.get_tmp_directory() as temp_dir, open(archive, "rb") as f:
        importer(f, temp_dir, task_data, conv_mask_to_poly=True)

    task_annotation.create(task_data.data.serialize())


def _import_videos(
    db_project: models.Project, units: list[_VideoUnit], format_name: str | None, work_dir: Path
) -> None:
    for index, unit in enumerate(units):
        _set_stage("task", current=index + 1, total=len(units), name=unit.name)
        db_task = _create_video_task(db_project, unit)

        if not unit.files:
            continue

        _set_stage("annotations", current=index + 1, total=len(units), name=unit.name)
        archive = work_dir / f"annotations-{index}.zip"
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_STORED) as zf:
            for file, arcname in unit.files:
                zf.write(file, arcname)

        try:
            _import_task_annotations(db_task, archive, format_name)
        except Exception as ex:
            raise CvatImportError(f"{unit.video.name}: {format_import_exception(ex)}") from ex
        finally:
            archive.unlink(missing_ok=True)


def run_import(work_dir: str, name: str, format_name: str, user_id: int) -> int:
    work_path = Path(work_dir)
    archive = work_path / "upload.zip"
    db_project = None
    try:
        if not zipfile.is_zipfile(archive):
            raise CvatImportError("The file is not a zip archive")

        with zipfile.ZipFile(archive) as zf:
            is_backup = backup._ProjectBackupBase.MANIFEST_FILENAME in zf.namelist()

        if is_backup:
            _set_stage("backup")
            project_id = backup.import_project(str(archive), user_id, None)
            if name:
                models.Project.objects.filter(pk=project_id).update(name=name)
            return project_id

        _set_stage("extract")
        data_dir = work_path / "data"
        _extract(archive, data_dir)

        units = _find_video_units(data_dir)
        if units:
            annotation_files = [f for unit in units for f, _ in unit.files]
            format_name = (
                _resolve_format(format_name, data_dir, annotation_files)
                if annotation_files
                else None
            )
            db_project = _create_project(name, user_id)
            _import_videos(db_project, units, format_name, work_path)
        else:
            format_name = _resolve_format(
                format_name, data_dir, [p for p in data_dir.rglob("*") if p.is_file()]
            )
            shutil.rmtree(data_dir)
            db_project = _create_project(name, user_id)
            _set_stage("dataset")
            import_dataset_as_project(str(archive), db_project.id, format_name, True)

        return db_project.id
    except Exception as ex:
        job = rq.get_current_job()
        job.meta[META_ERROR] = (
            str(ex) if isinstance(ex, CvatImportError) else format_import_exception(ex)
        ) or traceback.format_exception_only(ex)[-1].strip()
        job.save_meta()
        if db_project is not None:
            db_project.delete()
        raise
    finally:
        shutil.rmtree(work_path, ignore_errors=True)


def _require_user(request):
    if not request.user.is_authenticated:
        return JsonResponse({"detail": "Authentication required"}, status=401)
    return None


@require_POST
def start_import(request):
    if error := _require_user(request):
        return error

    name = request.GET.get("name", "").strip()
    format_name = request.GET.get("format", AUTO_FORMAT)
    import_id = str(uuid.uuid4())
    work_dir = _root() / import_id
    work_dir.mkdir(parents=True)
    # the body is the zip archive, ASGI has already buffered it in a temporary file
    with open(work_dir / "upload.zip", "wb") as upload:
        shutil.copyfileobj(request, upload, COPY_BUFFER_SIZE)

    queue = django_rq.get_queue(settings.CVAT_QUEUES.IMPORT_DATA.value)
    queue.enqueue_call(
        func=run_import,
        args=(str(work_dir), name or "Imported project", format_name, request.user.id),
        job_id=JOB_ID_PREFIX + import_id,
        timeout=JOB_TIMEOUT,
        result_ttl=24 * 60 * 60,
        failure_ttl=24 * 60 * 60,
    )
    return JsonResponse({"id": import_id}, status=202)


@require_GET
def import_status(request, import_id: str):
    if error := _require_user(request):
        return error

    try:
        uuid.UUID(import_id)
    except ValueError:
        raise Http404()
    queue = django_rq.get_queue(settings.CVAT_QUEUES.IMPORT_DATA.value)
    job = queue.fetch_job(JOB_ID_PREFIX + import_id)
    if job is None:
        raise Http404()

    status = job.get_status(refresh=True)
    meta = job.get_meta(refresh=True) if hasattr(job, "get_meta") else job.meta
    response = {
        "status": str(status.value if hasattr(status, "value") else status),
        "stage": meta.get(META_STAGE),
        "message": meta.get("status") or "",
        "progress": meta.get("progress"),
    }
    if response["status"] == "finished":
        response["project_id"] = job.return_value()
    elif response["status"] == "failed":
        response["error"] = meta.get(META_ERROR) or "Import failed"
    return JsonResponse(response)


urlpatterns = [
    path("project-import", start_import),
    path("project-import/<str:import_id>", import_status),
]
