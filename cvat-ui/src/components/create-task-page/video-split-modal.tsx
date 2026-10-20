// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, {
    useCallback, useEffect, useRef, useState,
} from 'react';
import Modal from 'antd/lib/modal';
import Button from 'antd/lib/button';
import Checkbox from 'antd/lib/checkbox';
import InputNumber from 'antd/lib/input-number';
import Slider from 'antd/lib/slider';
import Space from 'antd/lib/space';
import Spin from 'antd/lib/spin';
import Alert from 'antd/lib/alert';
import Tooltip from 'antd/lib/tooltip';
import Text from 'antd/lib/typography/Text';
import {
    DeleteOutlined, PauseCircleOutlined, PlayCircleOutlined, PlusOutlined, ScissorOutlined,
    VerticalLeftOutlined, VerticalRightOutlined,
} from '@ant-design/icons';

import { t } from 'cvat-i18n';
import { getVideoInfo, VideoInfo } from 'utils/video-info';
import { getServerVideoPreview } from 'utils/video-preview';
import { isDesktop } from 'utils/environment';

export interface VideoSegment {
    id: number;
    start: number; // first frame
    stop: number; // last frame, inclusive
    checked: boolean;
}

export interface VideoSplit {
    info: VideoInfo;
    segments: VideoSegment[];
}

interface Props {
    file: File;
    split: VideoSplit | null;
    getSegmentName: (segmentNumber: number) => string;
    onOk: (split: VideoSplit) => void;
    onCancel: () => void;
}

let nextSegmentId = 1;

function makeSegment(start: number, stop: number): VideoSegment {
    return {
        id: nextSegmentId++, start, stop, checked: true,
    };
}

export function splitEvenly(frameCount: number, count: number): VideoSegment[] {
    const n = Math.max(1, Math.min(count, frameCount));
    return Array(n).fill(null).map((_, i) => makeSegment(
        Math.round((i * frameCount) / n),
        Math.round(((i + 1) * frameCount) / n) - 1,
    ));
}

// more segments than this make the dialog slow and are hardly useful
const MAX_SEGMENTS = 500;

export function splitBySeconds(frameCount: number, fps: number, seconds: number): VideoSegment[] {
    const length = Math.max(1, Math.round(seconds * fps), Math.ceil(frameCount / MAX_SEGMENTS));
    const segments: VideoSegment[] = [];
    for (let start = 0; start < frameCount; start += length) {
        segments.push(makeSegment(start, Math.min(frameCount, start + length) - 1));
    }
    return segments;
}

function formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds - minutes * 60;
    return `${minutes.toString().padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
}

function sortSegments(segments: VideoSegment[]): VideoSegment[] {
    return [...segments].sort((a, b) => a.start - b.start || a.stop - b.stop);
}

export default function VideoSplitModal(props: Props): JSX.Element {
    const {
        file, split, getSegmentName, onOk, onCancel,
    } = props;

    const videoRef = useRef<HTMLVideoElement>(null);
    const [info, setInfo] = useState<VideoInfo | null>(split?.info ?? null);
    const [loadError, setLoadError] = useState<string>('');
    const [segments, setSegments] = useState<VideoSegment[]>(split?.segments ?? []);
    const [segmentSeconds, setSegmentSeconds] = useState<number>(10);
    const [currentFrame, setCurrentFrame] = useState<number>(0);
    const [playing, setPlaying] = useState<boolean>(false);
    const [previewId, setPreviewId] = useState<number | null>(null);
    // the end of the previewed segment, read from the frame callback
    const previewStopRef = useRef<number | null>(null);

    const [url, setUrl] = useState<string>('');
    useEffect(() => {
        const objectUrl = URL.createObjectURL(file);
        setUrl(objectUrl);
        return () => URL.revokeObjectURL(objectUrl);
    }, [file]);

    // a preview converted by the server, for videos the browser cannot play
    const [serverUrl, setServerUrl] = useState<string>('');
    const [serverProgress, setServerProgress] = useState<number | null>(null);
    const unsubscribeRef = useRef<(() => void) | null>(null);
    useEffect(() => () => unsubscribeRef.current?.(), []);

    const startServerPreview = (): void => {
        if (!isDesktop || serverUrl || serverProgress !== null) {
            setLoadError(t('The video cannot be played here'));
            return;
        }

        setLoadError('');
        setServerProgress(0);
        const { promise, unsubscribe } = getServerVideoPreview(file, setServerProgress);
        unsubscribeRef.current = unsubscribe;
        promise.then((preview) => {
            const serverInfo = {
                duration: preview.frameCount / preview.fps,
                fps: preview.fps,
                frameCount: preview.frameCount,
                exact: true,
            };
            setInfo((prev) => prev ?? serverInfo);
            setSegments((prev) => (prev.length ? prev : splitEvenly(preview.frameCount, 1)));
            setServerUrl(preview.url);
        }).catch((error: Error) => {
            setLoadError(t('Could not prepare the video for preview: {{error}}', { error: error.message }));
        }).finally(() => {
            unsubscribe();
            setServerProgress(null);
        });
    };

    const lastFrame = info ? info.frameCount - 1 : 0;
    const frameOfTime = useCallback((time: number): number => (
        info ? Math.max(0, Math.min(info.frameCount - 1, Math.floor(time * info.fps + 1e-3))) : 0
    ), [info]);
    const timeOfFrame = (frame: number): number => (info ? frame / info.fps : 0);

    const seek = (frame: number): void => {
        const video = videoRef.current;
        if (!video || !info) return;
        // the middle of the frame to avoid landing on the previous one because of rounding
        video.currentTime = Math.min(info.duration, (frame + 0.5) / info.fps);
        setCurrentFrame(frame);
    };

    const stopPreview = (): void => {
        previewStopRef.current = null;
        setPreviewId(null);
    };

    const onLoadedMetadata = (): void => {
        const video = videoRef.current;
        if (!video) return;
        if (!video.videoWidth) {
            // e.g. only the audio of the file can be played
            startServerPreview();
            return;
        }
        if (info) return;
        getVideoInfo(file, video).then((result) => {
            if (!result) {
                setLoadError(t('Could not determine the frame rate of the video'));
                return;
            }
            video.muted = false;
            video.currentTime = 0;
            setInfo(result);
            if (!segments.length) {
                setSegments(splitEvenly(result.frameCount, 1));
            }
        }).catch((error) => setLoadError(String(error)));
    };

    // tracks the shown frame precisely while the video is playing
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !info || !playing || typeof video.requestVideoFrameCallback !== 'function') return () => {};

        let handle = 0;
        const onFrame = (_: number, metadata: VideoFrameCallbackMetadata): void => {
            const frame = frameOfTime(metadata.mediaTime);
            const stop = previewStopRef.current;
            if (stop !== null && frame >= stop) {
                video.pause();
                setCurrentFrame(stop);
                stopPreview();
                return;
            }
            setCurrentFrame(frame);
            handle = video.requestVideoFrameCallback(onFrame);
        };
        handle = video.requestVideoFrameCallback(onFrame);
        return () => video.cancelVideoFrameCallback(handle);
    }, [info, playing, frameOfTime]);

    const onTimeUpdate = (): void => {
        const video = videoRef.current;
        if (!video || !info) return;
        if (!playing || typeof video.requestVideoFrameCallback !== 'function') {
            const frame = frameOfTime(video.currentTime);
            const stop = previewStopRef.current;
            if (playing && stop !== null && frame >= stop) {
                video.pause();
                stopPreview();
            }
            setCurrentFrame(frame);
        }
    };

    const togglePreview = (segment: VideoSegment): void => {
        const video = videoRef.current;
        if (!video) return;
        if (previewId === segment.id) {
            video.pause();
            stopPreview();
            return;
        }
        seek(segment.start);
        previewStopRef.current = segment.stop;
        setPreviewId(segment.id);
        video.play().catch(() => stopPreview());
    };

    const updateSegment = (id: number, values: Partial<VideoSegment>): void => {
        setSegments((prev) => prev.map((segment) => (segment.id === id ? { ...segment, ...values } : segment)));
    };

    const removeSegment = (id: number): void => {
        if (previewId === id) stopPreview();
        setSegments((prev) => prev.filter((segment) => segment.id !== id));
    };

    const splitAtCurrentFrame = (): void => {
        setSegments((prev) => {
            const target = prev.find((segment) => segment.start < currentFrame && currentFrame <= segment.stop);
            if (!target) return prev;
            const rest = prev.filter((segment) => segment !== target);
            return sortSegments([
                ...rest,
                { ...target, stop: currentFrame - 1 },
                { ...makeSegment(currentFrame, target.stop), checked: target.checked },
            ]);
        });
    };

    const addSegment = (): void => {
        if (!info) return;
        const length = Math.max(1, Math.round(info.fps * 10));
        setSegments((prev) => sortSegments([
            ...prev, makeSegment(currentFrame, Math.min(lastFrame, currentFrame + length - 1)),
        ]));
    };

    const canSplitAtCurrentFrame = segments.some(
        (segment) => segment.start < currentFrame && currentFrame <= segment.stop,
    );
    const checkedCount = segments.filter((segment) => segment.checked).length;
    const invalid = segments.some((segment) => segment.start > segment.stop);

    const handleOk = (): void => {
        if (!info) return;
        videoRef.current?.pause();
        onOk({ info, segments: sortSegments(segments) });
    };

    const handleCancel = (): void => {
        videoRef.current?.pause();
        onCancel();
    };

    const renderTimeline = (): JSX.Element | null => {
        if (!info) return null;
        const percent = (frame: number): string => `${(frame / info.frameCount) * 100}%`;
        return (
            <div
                className='cvat-video-split-timeline'
                role='presentation'
                onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const ratio = (event.clientX - rect.left) / rect.width;
                    seek(Math.max(0, Math.min(lastFrame, Math.floor(ratio * info.frameCount))));
                }}
            >
                {segments.map((segment, index) => (
                    <Tooltip key={segment.id} title={`#${index + 1}`}>
                        <div
                            className={`cvat-video-split-timeline-segment${segment.checked ? ' cvat-video-split-timeline-segment-checked' : ''}`}
                            style={{
                                left: percent(segment.start),
                                width: percent(segment.stop - segment.start + 1),
                            }}
                        >
                            {index + 1}
                        </div>
                    </Tooltip>
                ))}
                <div className='cvat-video-split-timeline-cursor' style={{ left: percent(currentFrame) }} />
            </div>
        );
    };

    const renderSegment = (segment: VideoSegment, index: number): JSX.Element => (
        <div key={segment.id} className='cvat-video-split-segment'>
            <div className='cvat-video-split-segment-header'>
                <Checkbox
                    checked={segment.checked}
                    onChange={(event) => updateSegment(segment.id, { checked: event.target.checked })}
                >
                    <Text strong>{`#${index + 1}`}</Text>
                </Checkbox>
                <Text type='secondary' ellipsis className='cvat-video-split-segment-name'>
                    {getSegmentName(index + 1)}
                </Text>
                <Text type='secondary'>
                    {t('{{count}} frames, {{duration}}', {
                        count: segment.stop - segment.start + 1,
                        duration: formatTime(timeOfFrame(segment.stop - segment.start + 1)),
                    })}
                </Text>
                <Space size={4}>
                    <Tooltip title={previewId === segment.id ? t('Stop') : t('Play the segment')}>
                        <Button
                            size='small'
                            icon={previewId === segment.id ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                            onClick={() => togglePreview(segment)}
                        />
                    </Tooltip>
                    <Tooltip title={t('Delete the segment')}>
                        <Button
                            size='small'
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => removeSegment(segment.id)}
                        />
                    </Tooltip>
                </Space>
            </div>
            <Slider
                range
                min={0}
                max={lastFrame}
                value={[segment.start, segment.stop]}
                tooltip={{ formatter: (value) => `${value} (${formatTime(timeOfFrame(value ?? 0))})` }}
                onChange={([start, stop]: number[]) => {
                    updateSegment(segment.id, { start, stop });
                    seek(start !== segment.start ? start : stop);
                }}
            />
            <div className='cvat-video-split-segment-bounds'>
                <Space size={4}>
                    <Text>{t('Start frame')}</Text>
                    <InputNumber
                        size='small'
                        min={0}
                        max={lastFrame}
                        precision={0}
                        value={segment.start}
                        onChange={(value) => {
                            if (value !== null) {
                                updateSegment(segment.id, { start: value });
                                seek(value);
                            }
                        }}
                    />
                    <Text type='secondary'>{formatTime(timeOfFrame(segment.start))}</Text>
                    <Tooltip title={t('Set to the current frame')}>
                        <Button
                            size='small'
                            icon={<VerticalRightOutlined />}
                            onClick={() => updateSegment(segment.id, { start: currentFrame })}
                        />
                    </Tooltip>
                </Space>
                <Space size={4}>
                    <Text>{t('Stop frame')}</Text>
                    <InputNumber
                        size='small'
                        min={0}
                        max={lastFrame}
                        precision={0}
                        value={segment.stop}
                        status={segment.start > segment.stop ? 'error' : undefined}
                        onChange={(value) => {
                            if (value !== null) {
                                updateSegment(segment.id, { stop: value });
                                seek(value);
                            }
                        }}
                    />
                    <Text type='secondary'>{formatTime(timeOfFrame(segment.stop))}</Text>
                    <Tooltip title={t('Set to the current frame')}>
                        <Button
                            size='small'
                            icon={<VerticalLeftOutlined />}
                            onClick={() => updateSegment(segment.id, { stop: currentFrame })}
                        />
                    </Tooltip>
                </Space>
            </div>
        </div>
    );

    return (
        <Modal
            open
            width={900}
            className='cvat-video-split-modal'
            title={t('Split video: {{name}}', { name: file.name })}
            okText={t('Ok')}
            cancelText={t('Cancel')}
            okButtonProps={{ disabled: !info || !checkedCount || invalid }}
            onOk={handleOk}
            onCancel={handleCancel}
            destroyOnClose
        >
            {loadError ? (
                <Alert type='error' showIcon message={loadError} />
            ) : null}
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
                ref={videoRef}
                className='cvat-video-split-player'
                src={serverUrl || url || undefined}
                hidden={serverProgress !== null}
                controls
                preload='auto'
                onLoadedMetadata={onLoadedMetadata}
                onTimeUpdate={onTimeUpdate}
                onSeeked={onTimeUpdate}
                onPlay={() => setPlaying(true)}
                onPause={() => {
                    setPlaying(false);
                    stopPreview();
                }}
                onError={startServerPreview}
            />
            {info && serverProgress === null ? (
                <>
                    <div className='cvat-video-split-info'>
                        <Text>
                            {t('Current frame: {{frame}}', { frame: currentFrame })}
                            {` (${formatTime(timeOfFrame(currentFrame))})`}
                        </Text>
                        <Text type='secondary'>
                            {t('{{frames}} frames, {{fps}} FPS', {
                                frames: info.frameCount,
                                fps: Math.round(info.fps * 100) / 100,
                            })}
                            {info.exact ? '' : ` (${t('estimated')})`}
                        </Text>
                    </div>
                    {renderTimeline()}
                    <div className='cvat-video-split-toolbar'>
                        <Space size={4}>
                            <Text>{t('Split every')}</Text>
                            <InputNumber
                                size='small'
                                min={0.1}
                                step={1}
                                precision={1}
                                value={segmentSeconds}
                                onChange={(value) => setSegmentSeconds(value ?? 10)}
                            />
                            <Text>{t('seconds into a segment')}</Text>
                            <Button
                                size='small'
                                onClick={() => {
                                    stopPreview();
                                    setSegments(splitBySeconds(info.frameCount, info.fps, segmentSeconds));
                                }}
                            >
                                {t('Apply')}
                            </Button>
                        </Space>
                        <Space size={4}>
                            <Button
                                size='small'
                                icon={<ScissorOutlined />}
                                disabled={!canSplitAtCurrentFrame}
                                onClick={splitAtCurrentFrame}
                            >
                                {t('Split at the current frame')}
                            </Button>
                            <Button size='small' icon={<PlusOutlined />} onClick={addSegment}>
                                {t('Add segment')}
                            </Button>
                        </Space>
                    </div>
                    <div className='cvat-video-split-segments'>
                        {segments.map(renderSegment)}
                    </div>
                    <Text type={checkedCount ? 'secondary' : 'danger'}>
                        {t('Selected {{checked}} of {{count}} segments, one task will be created for each', {
                            checked: checkedCount,
                            count: segments.length,
                        })}
                    </Text>
                </>
            ) : null}
            {serverProgress !== null ? (
                <Spin
                    className='cvat-video-split-loading'
                    tip={t('The browser cannot play this video, preparing a preview: {{progress}}%', {
                        progress: Math.round(serverProgress * 100),
                    })}
                >
                    <div className='cvat-video-split-loading-placeholder' />
                </Spin>
            ) : null}
            {!info && !loadError && serverProgress === null ? <Spin className='cvat-video-split-loading' /> : null}
        </Modal>
    );
}
