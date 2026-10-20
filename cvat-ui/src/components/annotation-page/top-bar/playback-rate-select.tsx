// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import Select, { RefSelectProps } from 'antd/lib/select';

import CVATTooltip from 'components/common/cvat-tooltip';
import { CombinedState } from 'reducers';
import { changePlaybackRate } from 'actions/settings-actions';
import { PLAYBACK_RATES, formatPlaybackRate } from 'utils/playback';
import { t } from 'cvat-i18n';

const options = PLAYBACK_RATES.map((rate) => ({ value: rate, label: formatPlaybackRate(rate) }));

function PlaybackRateSelect(): JSX.Element {
    const dispatch = useDispatch();
    const playbackRate = useSelector((state: CombinedState) => state.settings.player.playbackRate);
    const selectRef = useRef<RefSelectProps>(null);

    return (
        <CVATTooltip title={t('Playback rate')} placement='bottom'>
            <Select
                ref={selectRef}
                className='cvat-player-playback-rate'
                size='small'
                popupMatchSelectWidth={false}
                value={playbackRate}
                options={options}
                onChange={(value: number) => {
                    dispatch(changePlaybackRate(value));
                    // keep keyboard shortcuts (e.g. space to play) working after the choice
                    selectRef.current?.blur();
                }}
            />
        </CVATTooltip>
    );
}

export default React.memo(PlaybackRateSelect);
