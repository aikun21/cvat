// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

// Display names for enum values coming from the server / cvat-core
// (job states and stages, shape and label types, ...). The values themselves
// must never be translated, only the text shown to the user.

import { t, isChinese } from 'cvat-i18n';

const ENUM_NAMES: Record<string, () => string> = {
    // job state
    new: () => t('new'),
    'in progress': () => t('in progress'),
    completed: () => t('completed'),
    rejected: () => t('rejected'),
    // job stage / job type
    annotation: () => t('annotation'),
    validation: () => t('validation'),
    acceptance: () => t('acceptance'),
    ground_truth: () => t('ground_truth'),
    consensus_replica: () => t('consensus_replica'),
    // shape, object and label types
    any: () => t('any'),
    rectangle: () => t('rectangle'),
    polygon: () => t('polygon'),
    polyline: () => t('polyline'),
    points: () => t('points'),
    ellipse: () => t('ellipse'),
    cuboid: () => t('cuboid'),
    skeleton: () => t('skeleton'),
    mask: () => t('mask'),
    tag: () => t('tag'),
    shape: () => t('shape'),
    track: () => t('track'),
    interval: () => t('interval'),
    // objects appearance: color by
    Label: () => t('Label'),
    Instance: () => t('Instance'),
    Group: () => t('Group'),
    // annotation workspaces
    'Standard 3D': () => t('Standard 3D'),
    Standard: () => t('Standard'),
    'Attribute annotation': () => t('Attribute annotation'),
    'Single shape': () => t('Single shape'),
    'Tag annotation': () => t('Tag annotation'),
    Review: () => t('Review'),
    'Audio annotation': () => t('Audio annotation'),
    // objects list ordering
    'ID - descent': () => t('ID - descent'),
    'ID - ascent': () => t('ID - ascent'),
    'Updated time': () => t('Updated time'),
    Layer: () => t('Layer'),
    'Label name': () => t('Label name'),
    // resource words used inside sentences (see TRANSLATED_PLACEHOLDERS in cvat-i18n)
    job: () => t('job'),
    jobs: () => t('jobs'),
    task: () => t('task'),
    tasks: () => t('tasks'),
    project: () => t('project'),
    projects: () => t('projects'),
    dataset: () => t('dataset'),
    annotations: () => t('annotations'),
    backup: () => t('backup'),
    Dataset: () => t('Dataset'),
    Annotations: () => t('Annotations'),
    Backup: () => t('Backup'),
    Annotation: () => t('Annotation'),
    // shortcut scopes
    GENERAL: () => t('GENERAL'),
    ANNOTATION_PAGE: () => t('ANNOTATION_PAGE'),
    OBJECTS_SIDEBAR: () => t('OBJECTS_SIDEBAR'),
    STANDARD_WORKSPACE: () => t('STANDARD_WORKSPACE'),
    STANDARD_WORKSPACE_CONTROLS: () => t('STANDARD_WORKSPACE_CONTROLS'),
    ATTRIBUTE_ANNOTATION_WORKSPACE: () => t('ATTRIBUTE_ANNOTATION_WORKSPACE'),
    SINGLE_SHAPE_ANNOTATION_WORKSPACE: () => t('SINGLE_SHAPE_ANNOTATION_WORKSPACE'),
    TAG_ANNOTATION_WORKSPACE: () => t('TAG_ANNOTATION_WORKSPACE'),
    REVIEW_WORKSPACE_CONTROLS: () => t('REVIEW_WORKSPACE_CONTROLS'),
    '3D_ANNOTATION_WORKSPACE': () => t('3D_ANNOTATION_WORKSPACE'),
    '3D_ANNOTATION_WORKSPACE_CONTROLS': () => t('3D_ANNOTATION_WORKSPACE_CONTROLS'),
    AUDIO_WORKSPACE_CONTROLS: () => t('AUDIO_WORKSPACE_CONTROLS'),
    LABELS_EDITOR: () => t('LABELS_EDITOR'),
    // attribute input types
    checkbox: () => t('checkbox'),
    radio: () => t('radio'),
    select: () => t('select'),
    number: () => t('number'),
    text: () => t('text'),
    // annotation source
    manual: () => t('manual'),
    'semi-auto': () => t('semi-auto'),
    auto: () => t('auto'),
    file: () => t('file'),
    consensus: () => t('consensus'),
    // background request status
    queued: () => t('queued'),
    started: () => t('started'),
    finished: () => t('finished'),
    canceled: () => t('canceled'),
    failed: () => t('failed'),
    unknown: () => t('unknown'),
};

export function translateEnum(value: string | null | undefined): string {
    if (value === null || value === undefined) return '';
    const name = ENUM_NAMES[value];
    return name ? name() : value;
}

// Progress messages sent by cvat-core and by the server (engine/task.py) while
// creating tasks, uploading data and saving annotations.
const MESSAGES: Record<string, () => string> = {
    'CVAT is creating your task': () => t('CVAT is creating your task'),
    'CVAT is uploading task data to the server': () => t('CVAT is uploading task data to the server'),
    'The dataset is being uploaded to the server': () => t('The dataset is being uploaded to the server'),
    'Collection is being saved on the server': () => t('Collection is being saved on the server'),
    'Updated objects are being saved on the server': () => t('Updated objects are being saved on the server'),
    'Deleted objects are being deleted from the server': () => t('Deleted objects are being deleted from the server'),
    'Created objects are being saved on the server': () => t('Created objects are being saved on the server'),
    'Validating the input manifest file': () => t('Validating the input manifest file'),
    'Preparing a manifest file': () => t('Preparing a manifest file'),
    'A manifest has been created': () => t('A manifest has been created'),
    'Downloading input media': () => t('Downloading input media'),
    'Media files are being extracted...': () => t('Media files are being extracted...'),
    'CVAT is preparing data chunks': () => t('CVAT is preparing data chunks'),
};

// Translates a known progress message; a known message followed by extra text
// (e.g. "CVAT is preparing data chunks |") keeps the extra text.
export function translateMessage(message: string | null | undefined): string {
    if (!message) return '';
    const exact = MESSAGES[message];
    if (exact) return exact();
    const prefix = Object.keys(MESSAGES).find((key) => message.startsWith(`${key} `));
    return prefix ? `${MESSAGES[prefix]()}${message.slice(prefix.length)}` : message;
}

// Background request types shown on the requests page ("export:annotations" etc.)
const REQUEST_TYPES: Record<string, () => string> = {
    'create:task': () => t('Create task'),
    'export:annotations': () => t('Export annotations'),
    'export:dataset': () => t('Export dataset'),
    'export:backup': () => t('Export backup'),
    'import:annotations': () => t('Import annotations'),
    'import:dataset': () => t('Import dataset'),
    'import:backup': () => t('Import backup'),
    'autoannotate:task': () => t('Automatic annotation'),
};

export function translateRequestType(type: string): string | null {
    const name = REQUEST_TYPES[type];
    return name ? name() : null;
}

export function capitalize(value: string): string {
    return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

// "RECTANGLE TRACK" in English, "矩形轨迹" in Chinese
export function formatObjectType(shapeType: string, objectType: string, isTag: boolean): string {
    if (!isChinese) {
        return isTag ? objectType.toUpperCase() : `${shapeType.toUpperCase()} ${objectType.toUpperCase()}`;
    }
    return isTag ? translateEnum(objectType) : `${translateEnum(shapeType)}${translateEnum(objectType)}`;
}
