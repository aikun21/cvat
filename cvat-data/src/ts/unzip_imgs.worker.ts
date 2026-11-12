// Copyright (C) 2021-2022 Intel Corporation
// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import JSZip from 'jszip';

onmessage = (e) => {
    let errored = false;
    function handleError(error): void {
        try {
            if (!errored) {
                postMessage({ error });
            }
        } finally {
            errored = true;
        }
    }

    try {
        const zip = new JSZip();
        if (e.data) {
            const {
                start, end, block, dimension, dimension2D,
            } = e.data;

            zip.loadAsync(block).then((_zip) => {
                let index = start;
                const files: Promise<void>[] = [];

                _zip.forEach((relativePath) => {
                    const fileIndex = index++;
                    if (fileIndex <= end) {
                        files.push(_zip.file(relativePath)
                            .async('blob')
                            .then(async (fileData) => {
                                if (!errored) {
                                    // do not need to read the rest of block if an error already occurred
                                    if (dimension === dimension2D) {
                                        const img = await createImageBitmap(fileData);
                                        postMessage({
                                            fileName: relativePath,
                                            index: fileIndex,
                                            data: img,
                                        });
                                    } else {
                                        postMessage({
                                            fileName: relativePath,
                                            index: fileIndex,
                                            data: fileData,
                                        });
                                    }
                                }
                            }));
                    }
                });

                // the chunk may have fewer files than expected, so the end is reported explicitly
                return Promise.all(files).then(() => {
                    if (!errored) {
                        postMessage({ done: true });
                    }
                });
            }).catch(handleError);
        }
    } catch (error) {
        handleError(error);
    }
};
