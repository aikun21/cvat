// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import { range, cloneDeep } from 'lodash';

import {
    Job, Task, ActionParameterType, BaseCollectionAction,
    ObjectType, ObjectState, Source, ShapeType,
} from 'cvat-core-wrapper';
import { t } from 'cvat-i18n';

type Collection = Parameters<BaseCollectionAction['run']>[0]['collection'];
type Track = Collection['tracks'][0];
type Shape = Collection['shapes'][0];

function imageBitmapToImageData(imageBitmap: ImageBitmap): ImageData {
    const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
    ctx.drawImage(imageBitmap, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

// compressed chunks may be downscaled, while shape points are in the original frame size
function imageScale(frameData: { width: number; height: number }, imageData: ImageData): [number, number] {
    return [imageData.width / frameData.width, imageData.height / frameData.height];
}

interface TrackedPosition {
    frame: number;
    points: number[];
}

// Indices of the positions to keep as keyframes, so that linear interpolation between them
// (as CVAT interpolates rectangles) differs from every tracked position by at most `tolerance` pixels
// (Douglas-Peucker simplification over frames)
function simplifyKeyframes(positions: TrackedPosition[], tolerance: number): number[] {
    if (tolerance <= 0 || positions.length <= 2) {
        return positions.map((_, idx) => idx);
    }

    const keep = new Set([0, positions.length - 1]);
    const stack: [number, number][] = [[0, positions.length - 1]];
    while (stack.length) {
        const [first, last] = stack.pop() as [number, number];
        let worst = -1;
        let worstDeviation = tolerance;
        for (let k = first + 1; k < last; k++) {
            const ratio = (positions[k].frame - positions[first].frame) /
                (positions[last].frame - positions[first].frame);
            const deviation = Math.max(...positions[k].points.map((value, idx) => {
                const from = positions[first].points[idx];
                return Math.abs(value - (from + (positions[last].points[idx] - from) * ratio));
            }));
            if (deviation > worstDeviation) {
                worst = k;
                worstDeviation = deviation;
            }
        }

        if (worst !== -1) {
            keep.add(worst);
            stack.push([first, worst], [worst, last]);
        }
    }

    return [...keep].sort((a, b) => a - b);
}

// runs one of the OpenCV trackers (see OpenCVWrapper.tracking) as an annotations action
export default class OpenCVTrackerAction extends BaseCollectionAction {
    #instance: Job | Task | null;
    #targetFrame: number;
    #convertRectangleShapesToTracks: boolean;
    #keyframeTolerance: number;
    readonly #openCVWrapper: any;
    readonly #trackerKey: string;
    readonly #name: string;

    public constructor(openCVWrapper: any, trackerKey: 'trackerMIL' | 'trackerKalman') {
        super();
        // a drawn rectangle usually should become a track of the object
        this.#convertRectangleShapesToTracks = true;
        // tracks get keyframes only where the movement changes, so they can still be edited
        this.#keyframeTolerance = 1;
        this.#targetFrame = 0;
        this.#instance = null;
        this.#trackerKey = trackerKey;
        this.#name = openCVWrapper.tracking[trackerKey].name;
        this.#openCVWrapper = openCVWrapper;
    }

    public async init(instance: Job | Task, parameters: Record<string, string>): Promise<void> {
        this.#instance = instance;
        this.#targetFrame = +parameters['Target frame'];
        this.#convertRectangleShapesToTracks = parameters['Convert rectangle shapes to tracks'] === 'true';
        this.#keyframeTolerance = Math.max(0, +(parameters['Keyframe tolerance (px)'] ?? this.#keyframeTolerance) || 0);
    }

    // Writes tracked positions to a track. Keyframes are added only where needed for the interpolation,
    // existing keyframes in the tracked range get the tracked positions, and where the tracker lost
    // the object (it left the image or was not found) the object becomes outside.
    #writeTrack(
        track: Track,
        objectState: ObjectState,
        startFrame: number,
        initialPoints: number[],
        results: { frame: number; points: number[] | null }[],
    ): void {
        const setKeyframe = (frame: number, points: number[], outside: boolean): void => {
            const existing = track.shapes.find((shape) => shape.frame === frame);
            if (existing) {
                existing.points = points;
                existing.outside = outside;
            } else {
                track.shapes.push({
                    frame,
                    attributes: [],
                    occluded: objectState.occluded,
                    outside,
                    points,
                    rotation: 0,
                    z_order: objectState.zOrder,
                    type: objectState.shapeType,
                });
            }
        };

        // the start frame becomes a keyframe, otherwise the interpolation before the first tracked
        // keyframe would start from an earlier keyframe
        if (!track.shapes.some((shape) => shape.frame === startFrame)) {
            setKeyframe(startFrame, initialPoints, false);
        }

        let positions: TrackedPosition[] = [{ frame: startFrame, points: initialPoints }];
        const writePositions = (): void => {
            for (const idx of simplifyKeyframes(positions, this.#keyframeTolerance)) {
                if (positions[idx].frame !== startFrame) {
                    setKeyframe(positions[idx].frame, positions[idx].points, false);
                }
            }

            for (const { frame, points } of positions) {
                const existing = track.shapes.find((shape) => shape.frame === frame);
                if (existing && frame !== startFrame) {
                    existing.points = points;
                    existing.outside = false;
                }
            }
        };

        for (const { frame, points } of results) {
            if (points) {
                positions.push({ frame, points });
            } else if (positions.length) {
                writePositions();
                setKeyframe(frame, positions[positions.length - 1].points, true);
                positions = [];
            }
        }

        if (positions.length) {
            writePositions();
        }
    }

    public async destroy(): Promise<void> {
        // nothing to destroy
    }

    public async run(
        {
            collection,
            frameData: { number },
            onProgress,
            cancelled,
        }: Parameters<BaseCollectionAction['run']>[0],
    ): ReturnType<BaseCollectionAction['run']> {
        const noChanges = {
            created: { shapes: [], tags: [], tracks: [] },
            deleted: { shapes: [], tags: [], tracks: [] },
        };

        if (this.#instance === null || number === this.#targetFrame) {
            return noChanges;
        }

        if (number >= this.#targetFrame) {
            throw new Error('OpenCV tracking backward is not supported');
        }

        const frameNumbers = this.#instance instanceof Job ?
            await this.#instance.frames.frameNumbers() : range(0, this.#instance.size);
        const targetFrameNumbers = frameNumbers.filter(
            (frameNumber: number) => frameNumber >= Math.min(number, this.#targetFrame) &&
                frameNumber <= Math.max(number, this.#targetFrame) &&
                frameNumber !== number,
        );

        if (targetFrameNumbers.length === 0) {
            return noChanges;
        }

        const objectStates = await this.#instance.annotations.get(number, false, []);
        const tracks = [...collection.tracks]; // shallow copy value as it may have added new values
        const { shapes } = collection;

        const [
            initialShapes,
            targetObjects,
            targetObjectStates,
        ] = ([] as (Shape | Track)[]).concat(shapes, tracks).reduce((acc, object) => {
            if (!Number.isInteger(object.clientID)) {
                return acc;
            }

            const objectState = objectStates.find((_objectState) => _objectState.clientID === object.clientID);
            if (!objectState) {
                return acc;
            }

            acc[0].push([...objectState.points as number[]]);

            if (this.#convertRectangleShapesToTracks && objectState.objectType === ObjectType.SHAPE) {
                const castedObject = object as Required<Shape>;
                const convertedTrack = {
                    source: Source.AUTO,
                    attributes: [],
                    elements: [],
                    frame: castedObject.frame,
                    group: castedObject.group,
                    label_id: castedObject.label_id,
                    shapes: [{
                        frame: castedObject.frame,
                        attributes: [],
                        occluded: castedObject.occluded,
                        outside: false,
                        points: [...castedObject.points],
                        rotation: castedObject.rotation,
                        z_order: castedObject.z_order,
                        type: castedObject.type,
                    }],
                };

                tracks.push(convertedTrack);
                acc[1].push(convertedTrack);
                acc[2].push(new Proxy(objectState, {
                    get(_objectState, p, receiver) {
                        if (p === 'objectType') {
                            return ObjectType.TRACK;
                        }

                        return Reflect.get(_objectState, p, receiver);
                    },
                }));
            } else {
                acc[1].push(object);
                acc[2].push(objectState);
            }

            return acc;
        }, [[], [], []] as [number[][], (Shape | Track)[], ObjectState[]]);

        if (!this.#openCVWrapper.isInitialized) {
            onProgress(t('OpenCV library initialization'), 0);
            await this.#openCVWrapper.initialize(() => {});
            if (cancelled()) {
                return noChanges;
            }
        }

        onProgress(t('Action is running'), 0);
        if (cancelled()) {
            return noChanges;
        }

        let currentProgress = 0;
        const progressPieces = targetFrameNumbers.length * initialShapes.length;
        const trackedShapes: Shape[] = [];

        for (let i = 0; i < initialShapes.length; i++) {
            const initialShape = initialShapes[i];
            const targetObject = targetObjects[i];
            const targetObjectState = targetObjectStates[i];
            const tracker = this.#openCVWrapper.tracking[this.#trackerKey].model();
            // tracked points by frame, null where the tracker lost the object
            const results: { frame: number; points: number[] | null }[] = [];

            try {
                let frameData = await this.#instance.frames.get(number);
                let image = await frameData.data();
                const imageData = imageBitmapToImageData(image.imageData as ImageBitmap);

                const [initialScaleX, initialScaleY] = imageScale(frameData, imageData);
                tracker.init(imageData, initialShape.map(
                    (value, idx) => value * (idx % 2 === 0 ? initialScaleX : initialScaleY),
                ));
                for (let j = 0; j < targetFrameNumbers.length; j++) {
                    currentProgress = i * targetFrameNumbers.length + j;

                    onProgress(t('Action is running'), Math.ceil((currentProgress / progressPieces) * 100));
                    await new Promise((resolve) => {
                        setTimeout(resolve);
                    });

                    if (cancelled()) {
                        return noChanges;
                    }

                    const frame = targetFrameNumbers[j];
                    frameData = await this.#instance.frames.get(frame);
                    if (frameData.deleted) {
                        continue;
                    }

                    image = await frameData.data();
                    const frameImageData = imageBitmapToImageData(image.imageData as ImageBitmap);
                    const [scaleX, scaleY] = imageScale(frameData, frameImageData);
                    const { updated, points: scaledPoints } = tracker.update(frameImageData);
                    const points = (scaledPoints as number[]).map(
                        (value, idx) => value / (idx % 2 === 0 ? scaleX : scaleY),
                    );
                    results.push({ frame, points: updated ? points : null });
                }
            } finally {
                tracker.delete();
            }

            if (targetObjectState.objectType === ObjectType.TRACK) {
                this.#writeTrack(targetObject as Track, targetObjectState, number, initialShape, results);
            } else {
                const castedObject = targetObject as Shape;
                for (const { frame, points } of results) {
                    if (points) {
                        trackedShapes.push({
                            elements: [],
                            group: castedObject.group,
                            frame,
                            source: Source.AUTO,
                            attributes: cloneDeep(castedObject.attributes),
                            occluded: castedObject.occluded,
                            outside: false,
                            points,
                            rotation: 0,
                            z_order: castedObject.z_order,
                            label_id: castedObject.label_id,
                            type: castedObject.type,
                        });
                    }
                }
            }
        }

        return {
            created: { shapes: trackedShapes, tags: [], tracks },
            deleted: {
                // remove shapes converted to tracks
                shapes: this.#convertRectangleShapesToTracks ?
                    shapes.filter((shape) => shape.type === ShapeType.RECTANGLE) : [],
                // remove existing tracks as they were modified and will be rewritten
                tracks: collection.tracks,
                tags: [],
            },
        };
    }

    public applyFilter(
        input: Parameters<BaseCollectionAction['applyFilter']>[0],
    ): ReturnType<BaseCollectionAction['applyFilter']> {
        const { collection, frameData } = input;

        return {
            shapes: collection.shapes
                .filter((shape) => shape.frame === frameData.number && ShapeType.RECTANGLE === shape.type),
            tags: [],
            tracks: collection.tracks.filter((track) => {
                if (track.shapes[0].type !== ShapeType.RECTANGLE) {
                    return false;
                }

                // must be any shapes before current frame
                const shapesBefore = track.shapes.filter(
                    (shape) => shape.frame <= frameData.number).sort((a, b) => a.frame - b.frame,
                );

                if (shapesBefore.length === 0) {
                    return false;
                }

                // last shape must not be outside
                return !shapesBefore[shapesBefore.length - 1].outside;
            }),
        };
    }

    public isApplicableForObject(objectState: ObjectState): boolean {
        return objectState.shapeType === ShapeType.RECTANGLE;
    }

    public get name(): BaseCollectionAction['name'] {
        return this.#name;
    }

    public get parameters(): BaseCollectionAction['parameters'] {
        return {
            'Keyframe tolerance (px)': {
                type: ActionParameterType.NUMBER,
                values: ['0', '10', '0.5'],
                defaultValue: String(this.#keyframeTolerance),
            },
            'Convert rectangle shapes to tracks': {
                type: ActionParameterType.CHECKBOX,
                values: ['true', 'false'],
                defaultValue: String(this.#convertRectangleShapesToTracks),
            },
            'Target frame': {
                type: ActionParameterType.NUMBER,
                values: ({ instance }) => {
                    if (instance instanceof Job) {
                        return [instance.startFrame, instance.stopFrame, 1].map((val) => val.toString());
                    }
                    return [0, instance.size - 1, 1].map((val) => val.toString());
                },
                defaultValue: ({ instance }) => {
                    if (instance instanceof Job) {
                        return instance.stopFrame.toString();
                    }
                    return (instance.size - 1).toString();
                },
            },
        };
    }
}
