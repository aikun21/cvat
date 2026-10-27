// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

// Desktop build: creates a new project from a zip archive of annotated data
// (project backup, videos with annotations or a dataset with images),
// see cvat/desktop/project_import.py.

import { getCore } from 'cvat-core-wrapper';

export const AUTO_FORMAT = 'auto';

export interface ProjectImportStage {
    stage: 'backup' | 'extract' | 'task' | 'annotations' | 'dataset';
    current?: number;
    total?: number;
    name?: string;
}

export interface ProjectImportStatus {
    status: string;
    stage: ProjectImportStage | null;
    message: string;
    progress: number | null;
    project_id?: number;
    error?: string;
}

const POLL_INTERVAL = 1000;

function csrfToken(): string {
    const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
}

function errorMessage(xhr: XMLHttpRequest): string {
    try {
        return JSON.parse(xhr.responseText).detail || `${xhr.status} ${xhr.statusText}`;
    } catch {
        return `${xhr.status} ${xhr.statusText}`;
    }
}

// uploads the archive and returns the id of the import, XHR reports the upload progress
function upload(
    file: File,
    name: string,
    format: string,
    onUploadProgress: (progress: number) => void,
): Promise<string> {
    const params = new URLSearchParams({ name, format });
    const url = `${getCore().config.backendAPI}/desktop/project-import?${params.toString()}`;

    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.withCredentials = true;
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.setRequestHeader('X-CSRFToken', csrfToken());
        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) onUploadProgress(event.loaded / event.total);
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(JSON.parse(xhr.responseText).id);
            } else {
                reject(new Error(errorMessage(xhr)));
            }
        };
        // e.g. the file was removed or the server is not running
        xhr.onerror = () => reject(new Error('Could not upload the archive'));
        xhr.send(file);
    });
}

export async function importProject(
    file: File,
    name: string,
    format: string,
    onUploadProgress: (progress: number) => void,
    onStatus: (status: ProjectImportStatus) => void,
): Promise<number> {
    const id = await upload(file, name, format, onUploadProgress);
    const statusUrl = `${getCore().config.backendAPI}/desktop/project-import/${id}`;

    while (true) {
        const response = await fetch(statusUrl, { credentials: 'include' });
        const status: ProjectImportStatus = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error((status as any).detail || `${response.status} ${response.statusText}`);
        }
        if (status.status === 'finished') {
            return status.project_id as number;
        }
        if (status.status === 'failed') {
            throw new Error(status.error);
        }
        onStatus(status);
        await new Promise((resolve) => {
            setTimeout(resolve, POLL_INTERVAL);
        });
    }
}
