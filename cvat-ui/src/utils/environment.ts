// Copyright (C) 2020-2022 Intel Corporation
// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

export function isDev(): boolean {
    return process.env.NODE_ENV === 'development';
}

// Single-user desktop (Electron) build: set CVAT_DESKTOP=true when building the UI.
// Features that need extra services or several users (cloud storages, organizations,
// serverless models, analytics, ...) are hidden in this build.
export const isDesktop = process.env.CVAT_DESKTOP === 'true';

// Action menu entries of projects/tasks/jobs that need features absent in the desktop build
const DESKTOP_HIDDEN_MENU_KEYS = new Set([
    'run_auto_annotation',
    'view-analytics',
    'quality_control',
    'quality-control',
    'consensus_management',
    'merge_consensus_jobs',
    'merge_specific_consensus_jobs',
    'go_to_replicas',
    'set-webhooks',
    'edit_organization',
]);

export function isHiddenInDesktop(key: unknown): boolean {
    return isDesktop && DESKTOP_HIDDEN_MENU_KEYS.has(String(key));
}
