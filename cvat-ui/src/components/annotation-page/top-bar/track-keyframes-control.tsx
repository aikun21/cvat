// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { NodeIndexOutlined } from '@ant-design/icons';
import Button from 'antd/lib/button';
import InputNumber from 'antd/lib/input-number';
import Popover from 'antd/lib/popover';
import message from 'antd/lib/message';
import notification from 'antd/lib/notification';
import Text from 'antd/lib/typography/Text';

import { getCore } from 'cvat-core-wrapper';
import { Canvas } from 'cvat-canvas-wrapper';
import { getCVATStore } from 'cvat-store';
import { CombinedState } from 'reducers';
import { fetchAnnotationsAsync } from 'actions/annotation-actions';
import CVATTooltip from 'components/common/cvat-tooltip';
import { t } from 'cvat-i18n';

const core = getCore();

// names of the actions in cvat-core/src/annotations-actions/track-keyframes.ts
const INSERT_ACTION = 'Insert track keyframes at intervals';
const REMOVE_ACTION = 'Remove redundant track keyframes';
const INTERVAL_PARAMETER = 'Interval, seconds';

interface Summary {
    tracks: number;
    keyframes: number;
}

// inserts a keyframe every N seconds into all tracks of a video job, or removes such keyframes
function TrackKeyframesControl(): JSX.Element | null {
    const dispatch = useDispatch();
    const job = useSelector((state: CombinedState) => state.annotation.job.instance);
    const frameNumber = useSelector((state: CombinedState) => state.annotation.player.frame.number);
    const [open, setOpen] = useState(false);
    const [seconds, setSeconds] = useState<number>(1);
    const [running, setRunning] = useState<string | null>(null);

    if (!job || job.mode !== 'interpolation' || job.dimension !== '2d') {
        return null;
    }

    const run = async (actionName: string): Promise<void> => {
        if (running) return;
        setRunning(actionName);
        try {
            const actions = await core.actions.list();
            const action = actions.find((item) => item.name === actionName);
            if (!action) throw new Error(`Unknown action: ${actionName}`);

            await core.actions.run(
                job,
                action,
                actionName === INSERT_ACTION ? { [INTERVAL_PARAMETER]: String(seconds) } : {},
                frameNumber,
                frameNumber,
                [],
                () => {},
                () => false,
            );

            // the same refresh as after running an action from the actions dialog
            const { annotation } = getCVATStore().getState();
            const canvas = annotation.canvas.instance as Canvas;
            canvas.setup(annotation.player.frame.data, []);
            dispatch(fetchAnnotationsAsync());

            const { summary } = action as unknown as { summary: Summary };
            if (!summary.keyframes) {
                message.info(actionName === INSERT_ACTION ?
                    t('There are no frames to insert keyframes') :
                    t('There are no keyframes to remove'));
            } else {
                message.success(actionName === INSERT_ACTION ?
                    t('Inserted {{keyframes}} keyframes into {{tracks}} tracks, press Ctrl+Z to undo', { ...summary }) :
                    t('Removed {{keyframes}} keyframes from {{tracks}} tracks, press Ctrl+Z to undo', { ...summary }));
            }
            setOpen(false);
        } catch (error: unknown) {
            notification.error({
                message: t('Could not update the keyframes'),
                description: error instanceof Error ? error.message : String(error),
                className: 'cvat-notification-track-keyframes-failed',
            });
        } finally {
            setRunning(null);
        }
    };

    const content = (
        <div className='cvat-track-keyframes-control-content'>
            <div className='cvat-track-keyframes-control-interval'>
                <Text>{t('Every')}</Text>
                <InputNumber
                    min={0.04}
                    max={3600}
                    step={0.5}
                    precision={2}
                    value={seconds}
                    onChange={(value) => {
                        if (typeof value === 'number' && value > 0) setSeconds(value);
                    }}
                    className='cvat-track-keyframes-control-seconds'
                />
                <Text>{t('seconds')}</Text>
            </div>
            <Button
                type='primary'
                block
                loading={running === INSERT_ACTION}
                disabled={!!running}
                onClick={() => run(INSERT_ACTION)}
                className='cvat-track-keyframes-control-insert'
            >
                {t('Insert keyframes')}
            </Button>
            <Button
                block
                danger
                loading={running === REMOVE_ACTION}
                disabled={!!running}
                onClick={() => run(REMOVE_ACTION)}
                className='cvat-track-keyframes-control-remove'
            >
                {t('Clear keyframes')}
            </Button>
            <Text type='secondary' className='cvat-track-keyframes-control-hint'>
                {t('Keyframes are inserted into all tracks on the same frames, at the interpolated positions. Clearing removes the keyframes that do not change the tracks: all inserted ones; edited keyframes and keyframes where objects appear or go outside are kept.')}
            </Text>
        </div>
    );

    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            trigger='click'
            placement='bottom'
            title={t('Track keyframes')}
            content={content}
            overlayClassName='cvat-track-keyframes-control-popover'
        >
            <CVATTooltip overlay={t('Insert a keyframe every few seconds or clear them')}>
                <Button type='link' className='cvat-annotation-header-track-keyframes-button cvat-annotation-header-button'>
                    <NodeIndexOutlined />
                    {t('Keyframes')}
                </Button>
            </CVATTooltip>
        </Popover>
    );
}

export default React.memo(TrackKeyframesControl);
