// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

// Frame rate and frame count of a local video file, used to convert between
// the time of the <video> element and the frame numbers of a CVAT task.

export interface VideoInfo {
    duration: number; // seconds
    fps: number;
    frameCount: number;
    exact: boolean; // read from the container (MP4/MOV), otherwise estimated during playback
}

interface Box {
    type: string;
    start: number; // offset of the box header
    dataStart: number; // offset of the box payload
    end: number;
}

async function readBytes(blob: Blob, start: number, end: number): Promise<DataView> {
    const buffer = await blob.slice(start, end).arrayBuffer();
    return new DataView(buffer);
}

function boxType(view: DataView, offset: number): string {
    return String.fromCharCode(
        view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3),
    );
}

function parseBoxes(view: DataView, start: number, end: number): Box[] {
    const boxes: Box[] = [];
    let offset = start;
    while (offset + 8 <= end) {
        let size = view.getUint32(offset);
        const type = boxType(view, offset + 4);
        let header = 8;
        if (size === 1) {
            size = Number(view.getBigUint64(offset + 8));
            header = 16;
        } else if (size === 0) {
            size = end - offset;
        }
        if (size < header) break;
        boxes.push({
            type, start: offset, dataStart: offset + header, end: Math.min(offset + size, end),
        });
        offset += size;
    }
    return boxes;
}

function child(view: DataView, parent: Box, type: string): Box | null {
    return parseBoxes(view, parent.dataStart, parent.end).find((box) => box.type === type) ?? null;
}

// finds the "moov" box among top-level boxes, reading only their headers
async function readMoov(file: File): Promise<DataView | null> {
    let offset = 0;
    while (offset + 8 <= file.size) {
        const header = await readBytes(file, offset, Math.min(offset + 16, file.size));
        let size = header.getUint32(0);
        const type = boxType(header, 4);
        if (size === 1 && header.byteLength >= 16) {
            size = Number(header.getBigUint64(8));
        } else if (size === 0) {
            size = file.size - offset;
        }
        if (size < 8) return null;
        if (type === 'moov') {
            return readBytes(file, offset, offset + size);
        }
        if (offset === 0 && type !== 'ftyp') return null; // not an ISO BMFF file
        offset += size;
    }
    return null;
}

async function readMP4Info(file: File): Promise<Omit<VideoInfo, 'duration'> | null> {
    const view = await readMoov(file);
    if (!view) return null;
    const [moov] = parseBoxes(view, 0, view.byteLength);
    for (const trak of parseBoxes(view, moov.dataStart, moov.end).filter((box) => box.type === 'trak')) {
        const mdia = child(view, trak, 'mdia');
        const hdlr = mdia ? child(view, mdia, 'hdlr') : null;
        if (!mdia || !hdlr || boxType(view, hdlr.dataStart + 8) !== 'vide') continue;

        const mdhd = child(view, mdia, 'mdhd');
        const minf = child(view, mdia, 'minf');
        const stbl = minf ? child(view, minf, 'stbl') : null;
        const stts = stbl ? child(view, stbl, 'stts') : null;
        if (!mdhd || !stts) return null;

        const timescale = view.getUint32(mdhd.dataStart + (view.getUint8(mdhd.dataStart) === 1 ? 20 : 12));
        const entries = view.getUint32(stts.dataStart + 4);
        let frameCount = 0;
        let ticks = 0;
        for (let i = 0; i < entries; i++) {
            const count = view.getUint32(stts.dataStart + 8 + i * 8);
            const delta = view.getUint32(stts.dataStart + 12 + i * 8);
            frameCount += count;
            ticks += count * delta;
        }
        if (!frameCount || !ticks || !timescale) return null;
        return { fps: (frameCount * timescale) / ticks, frameCount, exact: true };
    }
    return null;
}

// plays a few frames of the (muted) video and measures the time between them
function estimateFps(video: HTMLVideoElement): Promise<number | null> {
    if (typeof video.requestVideoFrameCallback !== 'function') return Promise.resolve(null);

    return new Promise((resolve) => {
        const deltas: number[] = [];
        let previous: { mediaTime: number; presentedFrames: number } | null = null;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const finish = (): void => {
            video.pause();
            clearTimeout(timeout);
            if (!deltas.length) {
                resolve(null);
                return;
            }
            const sorted = deltas.sort((a, b) => a - b);
            resolve(1 / sorted[Math.floor(sorted.length / 2)]);
        };
        timeout = setTimeout(finish, 3000);
        const onFrame = (_: number, metadata: VideoFrameCallbackMetadata): void => {
            if (previous && metadata.presentedFrames > previous.presentedFrames) {
                const delta = (metadata.mediaTime - previous.mediaTime) /
                    (metadata.presentedFrames - previous.presentedFrames);
                if (delta > 0) deltas.push(delta);
            }
            previous = metadata;
            if (deltas.length >= 10) {
                finish();
            } else {
                video.requestVideoFrameCallback(onFrame);
            }
        };
        video.requestVideoFrameCallback(onFrame);
        video.muted = true; // eslint-disable-line no-param-reassign
        video.play().catch(() => finish());
    });
}

export async function getVideoInfo(file: File, video: HTMLVideoElement): Promise<VideoInfo | null> {
    const { duration } = video;
    if (!Number.isFinite(duration) || duration <= 0) return null;

    let info: Omit<VideoInfo, 'duration'> | null = null;
    try {
        info = await readMP4Info(file);
    } catch (error) {
        console.warn(error);
    }

    if (!info) {
        const fps = await estimateFps(video);
        video.currentTime = 0; // eslint-disable-line no-param-reassign
        if (!fps) return null;
        info = { fps, frameCount: Math.max(1, Math.floor(duration * fps)), exact: false };
    }

    return { ...info, duration };
}
