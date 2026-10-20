// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

// Desktop build: videos the browser cannot play (e.g. MPEG-TS, HEVC) are converted
// to MP4 by the local server for the preview, see cvat/desktop/video_preview.py.

import { getCore } from 'cvat-core-wrapper';

export interface ServerVideoPreview {
    url: string;
    fps: number;
    frameCount: number;
}

interface PreviewStatus {
    status: 'processing' | 'done' | 'failed';
    progress?: number;
    fps?: number;
    frames?: number;
    error?: string;
}

const POLL_INTERVAL = 500;
// one conversion per file, the dialog may be opened several times
const previews = new WeakMap<File, Promise<ServerVideoPreview>>();
const listeners = new WeakMap<File, Set<(progress: number) => void>>();

function csrfToken(): string {
    const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
}

async function check(response: Response): Promise<any> {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(body.detail || `${response.status} ${response.statusText}`);
    }
    return body;
}

async function convert(file: File): Promise<ServerVideoPreview> {
    const base = `${getCore().config.backendAPI}/desktop/video-preview`;
    const notify = (progress: number): void => {
        listeners.get(file)?.forEach((listener) => listener(progress));
    };

    const { id } = await check(await fetch(base, {
        method: 'POST',
        body: file,
        credentials: 'include',
        headers: {
            'Content-Type': 'application/octet-stream',
            'X-CSRFToken': csrfToken(),
        },
    }));

    while (true) {
        const status: PreviewStatus = await check(await fetch(`${base}/${id}`, { credentials: 'include' }));
        if (status.status === 'done') {
            return { url: `${base}/${id}/video`, fps: status.fps as number, frameCount: status.frames as number };
        }
        if (status.status === 'failed') {
            throw new Error(status.error);
        }
        notify(status.progress ?? 0);
        await new Promise((resolve) => {
            setTimeout(resolve, POLL_INTERVAL);
        });
    }
}

export function getServerVideoPreview(
    file: File,
    onProgress: (progress: number) => void,
): { promise: Promise<ServerVideoPreview>; unsubscribe: () => void } {
    if (!listeners.has(file)) listeners.set(file, new Set());
    listeners.get(file)?.add(onProgress);

    let promise = previews.get(file);
    if (!promise) {
        promise = convert(file);
        // a failed conversion can be retried by opening the dialog again
        promise.catch(() => previews.delete(file));
        previews.set(file, promise);
    }

    return { promise, unsubscribe: () => listeners.get(file)?.delete(onProgress) };
}
