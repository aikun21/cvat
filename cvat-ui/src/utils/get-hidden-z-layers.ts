// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import type { CombinedState } from 'reducers';

// shared, so selectors comparing their results do not see a new value on every call
const NO_HIDDEN_LAYERS: ReadonlySet<number> = new Set<number>();

export default function getHiddenZLayers(state: CombinedState): Set<number> {
    const frame = state.annotation.player.frame.number;
    return state.annotation.annotations.zLayer.hiddenByFrame.get(frame) || NO_HIDDEN_LAYERS as Set<number>;
}
