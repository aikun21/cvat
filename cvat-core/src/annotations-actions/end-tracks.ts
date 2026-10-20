// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import { BaseCollectionAction, CollectionActionInput, CollectionActionOutput } from './base-collection-action';
import { ActionParameters } from './base-action';
import ObjectState from '../object-state';
import { ObjectType } from '../enums';

type Track = CollectionActionInput['collection']['tracks'][0];

// Ends tracks on the current frame: the object becomes outside from this frame
// and the keyframes after it are removed (otherwise the object would appear again on the next keyframe)
export class EndTracks extends BaseCollectionAction {
    public async init(): Promise<void> {
        // nothing to init
    }

    public async destroy(): Promise<void> {
        // nothing to destroy
    }

    public async run(input: CollectionActionInput): Promise<CollectionActionOutput> {
        const { collection: { tracks }, frameData: { number: frame } } = input;
        const ended: Track[] = tracks.map((track) => {
            const before = track.shapes.filter((shape) => shape.frame < frame).sort((a, b) => a.frame - b.frame);
            const current = track.shapes.find((shape) => shape.frame === frame);
            const last = current ?? before[before.length - 1];
            return {
                ...track,
                shapes: [...before, { ...last, frame, outside: true }],
                elements: (track.elements ?? []).map((element) => {
                    const elementBefore = element.shapes.filter((shape) => shape.frame < frame);
                    const elementCurrent = element.shapes.find((shape) => shape.frame === frame);
                    const elementLast = elementCurrent ?? elementBefore[elementBefore.length - 1];
                    return {
                        ...element,
                        shapes: elementLast ? [...elementBefore, { ...elementLast, frame, outside: true }] : elementBefore,
                    };
                }),
            };
        });

        return {
            created: { shapes: [], tags: [], tracks: ended },
            deleted: { shapes: [], tags: [], tracks },
        };
    }

    public applyFilter(
        input: Pick<CollectionActionInput, 'collection' | 'frameData'>,
    ): CollectionActionInput['collection'] {
        const { collection, frameData: { number: frame } } = input;
        return {
            shapes: [],
            tags: [],
            // tracks visible on the current frame that started before it
            tracks: collection.tracks.filter((track) => {
                const shapesBefore = track.shapes
                    .filter((shape) => shape.frame <= frame)
                    .sort((a, b) => a.frame - b.frame);
                return shapesBefore.length > 0 && shapesBefore[0].frame < frame &&
                    !shapesBefore[shapesBefore.length - 1].outside;
            }),
        };
    }

    public isApplicableForObject(objectState: ObjectState): boolean {
        return objectState.objectType === ObjectType.TRACK;
    }

    public get name(): string {
        return 'End tracks on the current frame';
    }

    public get parameters(): ActionParameters | null {
        return null;
    }
}
