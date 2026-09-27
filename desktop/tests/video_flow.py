"""End-to-end check of the video annotation flow against a running desktop backend.

Usage: python desktop/tests/video_flow.py [base_url] [username] [password]
"""

import io
import sys
import tempfile
import time
import zipfile
from pathlib import Path

import av
import numpy as np
import requests

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18080"
USER = sys.argv[2] if len(sys.argv) > 2 else "admin"
PASSWORD = sys.argv[3] if len(sys.argv) > 3 else "Admin@12345"
FRAMES = 90


def make_video(path: Path) -> None:
    with av.open(str(path), "w") as container:
        stream = container.add_stream("libx264", rate=30)
        stream.width, stream.height, stream.pix_fmt = 320, 240, "yuv420p"
        for i in range(FRAMES):
            img = np.zeros((240, 320, 3), dtype=np.uint8)
            img[80:140, 10 + i * 2 : 60 + i * 2] = (255, 128, 0)  # moving box
            for packet in stream.encode(av.VideoFrame.from_ndarray(img, format="rgb24")):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


def wait_request(s: requests.Session, rq_id: str, what: str) -> dict:
    for _ in range(300):
        r = s.get(f"{BASE}/api/requests/{rq_id}")
        r.raise_for_status()
        body = r.json()
        if body["status"] in ("finished", "failed"):
            assert body["status"] == "finished", f"{what} failed: {body.get('message')}"
            return body
        time.sleep(1)
    raise TimeoutError(what)


def main() -> None:
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"username": USER, "password": PASSWORD})
    r.raise_for_status()
    s.headers["Authorization"] = f"Token {r.json()['key']}"

    task = s.post(
        f"{BASE}/api/tasks",
        json={"name": "video flow check", "labels": [{"name": "car", "type": "rectangle"}]},
    )
    task.raise_for_status()
    task = task.json()
    print("task created:", task["id"])

    with tempfile.TemporaryDirectory() as tmp:
        video = Path(tmp) / "test.mp4"
        make_video(video)
        with open(video, "rb") as f:
            r = s.post(
                f"{BASE}/api/tasks/{task['id']}/data",
                data={"image_quality": 70, "use_cache": True},
                files={"client_files[0]": ("test.mp4", f, "video/mp4")},
            )
    r.raise_for_status()
    wait_request(s, r.json()["rq_id"], "task data processing")

    meta = s.get(f"{BASE}/api/tasks/{task['id']}/data/meta").json()
    print("frames:", meta["size"], "| frame size:", meta["frames"][0]["width"], "x", meta["frames"][0]["height"])
    assert meta["size"] == FRAMES, meta["size"]

    job = s.get(f"{BASE}/api/jobs", params={"task_id": task["id"]}).json()["results"][0]
    chunk = s.get(f"{BASE}/api/jobs/{job['id']}/data", params={"type": "chunk", "index": 0, "quality": "compressed"})
    chunk.raise_for_status()
    print("chunk 0:", len(chunk.content), "bytes,", chunk.headers.get("Content-Type"))
    frame = s.get(f"{BASE}/api/jobs/{job['id']}/data", params={"type": "frame", "number": 45, "quality": "original"})
    frame.raise_for_status()
    print("frame 45:", len(frame.content), "bytes,", frame.headers.get("Content-Type"))

    label_id = s.get(f"{BASE}/api/labels", params={"task_id": task["id"]}).json()["results"][0]["id"]
    track = {
        "frame": 0,
        "label_id": label_id,
        "group": 0,
        "source": "manual",
        "attributes": [],
        "shapes": [
            {"type": "rectangle", "frame": 0, "points": [10, 80, 60, 140], "outside": False, "occluded": False, "keyframe": True, "attributes": []},
            {"type": "rectangle", "frame": 89, "points": [188, 80, 238, 140], "outside": False, "occluded": False, "keyframe": True, "attributes": []},
        ],
    }
    r = s.put(f"{BASE}/api/jobs/{job['id']}/annotations", json={"version": 0, "tags": [], "shapes": [], "tracks": [track]})
    r.raise_for_status()
    saved = s.get(f"{BASE}/api/jobs/{job['id']}/annotations").json()
    print("saved tracks:", len(saved["tracks"]), "| keyframes:", len(saved["tracks"][0]["shapes"]))

    r = s.post(f"{BASE}/api/tasks/{task['id']}/dataset/export", params={"format": "CVAT for video 1.1", "save_images": False})
    r.raise_for_status()
    result = wait_request(s, r.json()["rq_id"], "export")
    archive = s.get(result["result_url"])
    archive.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(archive.content)) as zf:
        xml = zf.read("annotations.xml").decode()
    boxes = xml.count("<box ")
    print("export: annotations.xml with", boxes, "interpolated boxes")
    assert boxes >= FRAMES, boxes
    print("OK: video annotation flow works")


if __name__ == "__main__":
    main()
