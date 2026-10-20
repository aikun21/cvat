// Copyright (C) 2019-2022 Intel Corporation
// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

const config = {
    backendAPI: '/api',
    organization: {
        organizationID: null,
        organizationSlug: null,
    },
    origin: '',
    uploadChunkSize: 100,
    // quality of the chunks shown in 2D jobs, the desktop build uses the original quality
    jobChunkQuality: 'compressed' as 'compressed' | 'original',
    opencvPath: '',
    removeUnderlyingMaskPixels: {
        enabled: false,
        onEmptyMaskOccurrence: null,
    },
    onOrganizationChange: null,
    globalObjectsCounter: 0,

    requestsStatusDelay: null,

    jobMetaDataReloadPeriod: 1 * 60 * 60 * 1000, // 1 hour

    previewPlaceholders: {} as Record<string, string>,
};

export default config;
