// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

// Playback rate relative to the real speed of the video (1 = the frame rate of the video).
export const PLAYBACK_RATES = [0.25, 0.5, 1, 1.5, 2, 4, 8];
export const DEFAULT_PLAYBACK_RATE = 1;

// used when the frame rate is unknown, e.g. for tasks made of images
const DEFAULT_FPS = 25;
// every shown frame is rendered with its annotations, faster rates skip frames instead
const MAX_SHOWN_FPS = 30;

export function formatPlaybackRate(rate: number): string {
    return `${rate}x`;
}

export interface PlaybackPlan {
    step: number; // frames to advance each time
    delay: number; // milliseconds between shown frames
}

export function getPlaybackPlan(rate: number, videoFps: number | null): PlaybackPlan {
    const targetFps = Math.max(rate, 0.01) * (videoFps || DEFAULT_FPS);
    const step = Math.max(1, Math.ceil(targetFps / MAX_SHOWN_FPS));
    return { step, delay: (1000 * step) / targetFps };
}
