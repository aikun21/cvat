// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, {
    useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useHistory } from 'react-router';
import { AppstoreOutlined, LoadingOutlined } from '@ant-design/icons';
import Button from 'antd/lib/button';
import Drawer from 'antd/lib/drawer';
import Input from 'antd/lib/input';
import Spin from 'antd/lib/spin';
import Tag from 'antd/lib/tag';
import Empty from 'antd/lib/empty';
import Text from 'antd/lib/typography/Text';

import {
    getCore, Job, JobState, JobType, Task,
} from 'cvat-core-wrapper';
import { CombinedState } from 'reducers';
import CVATTooltip from 'components/common/cvat-tooltip';
import Preview from 'components/common/preview';
import { saveAnnotationsAsync } from 'actions/annotation-actions';
import { translateEnum } from 'utils/i18n-enums';
import { t } from 'cvat-i18n';

const core = getCore();

interface ProjectTask {
    task: Task;
    jobs: Job[];
}

function jobStateColor(state: JobState): string | undefined {
    if (state === JobState.COMPLETED) return 'success';
    if (state === JobState.IN_PROGRESS) return 'processing';
    if (state === JobState.REJECTED) return 'error';
    return undefined;
}

// shows all tasks of the project the job belongs to,
// clicking a task saves the job and opens the task in the annotation view
function ProjectTasksDrawer(): JSX.Element | null {
    const dispatch = useDispatch();
    const history = useHistory();
    const projectId = useSelector((state: CombinedState) => state.annotation.job.instance?.projectId ?? null);
    const currentJobId = useSelector((state: CombinedState) => state.annotation.job.instance?.id ?? null);
    const currentTaskId = useSelector((state: CombinedState) => state.annotation.job.instance?.taskId ?? null);
    const isSaving = useSelector((state: CombinedState) => state.annotation.annotations.saving.uploading);

    const [open, setOpen] = useState(false);
    const [fetching, setFetching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [projectTasks, setProjectTasks] = useState<ProjectTask[] | null>(null);
    const [search, setSearch] = useState('');
    const [switchingTo, setSwitchingTo] = useState<number | null>(null);
    const currentItemRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!open || projectId === null) return undefined;

        let cancelled = false;
        setFetching(true);
        setError(null);
        Promise.all([
            core.tasks.get({ projectId }, true),
            core.jobs.get({ projectID: projectId, type: JobType.ANNOTATION }, true),
        ]).then(([tasks, jobs]) => {
            if (cancelled) return;
            const jobsByTask = new Map<number, Job[]>();
            for (const job of jobs) {
                const taskJobs = jobsByTask.get(job.taskId as number) ?? [];
                taskJobs.push(job);
                jobsByTask.set(job.taskId as number, taskJobs);
            }
            setProjectTasks(
                [...tasks]
                    .sort((a, b) => a.id - b.id)
                    .map((task) => ({
                        task,
                        jobs: (jobsByTask.get(task.id) ?? []).sort((a, b) => a.startFrame - b.startFrame),
                    })),
            );
        }).catch((reason: unknown) => {
            if (cancelled) return;
            setError(reason instanceof Error ? reason.message : String(reason));
        }).finally(() => {
            if (!cancelled) setFetching(false);
        });

        return () => {
            cancelled = true;
        };
    }, [open, projectId]);

    // show the current task when the list is opened
    useEffect(() => {
        if (open && projectTasks) {
            setTimeout(() => currentItemRef.current?.scrollIntoView({ block: 'center' }));
        }
    }, [open, projectTasks]);

    const filteredTasks = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!projectTasks || !query) return projectTasks;
        return projectTasks.filter(({ task }) => (
            task.name.toLowerCase().includes(query) || String(task.id) === query
        ));
    }, [projectTasks, search]);

    const openJob = useCallback(async (job: Job): Promise<void> => {
        if (switchingTo !== null || isSaving) return;
        if (job.id === currentJobId) {
            setOpen(false);
            return;
        }

        setSwitchingTo(job.id);
        try {
            await dispatch(saveAnnotationsAsync());
        } catch {
            // the error is shown by the notifications, stay on the current job
            setSwitchingTo(null);
            return;
        }

        setOpen(false);
        history.push(`/tasks/${job.taskId}/jobs/${job.id}`);
    }, [switchingTo, isSaving, currentJobId]);

    if (projectId === null) {
        return null;
    }

    const renderTask = ({ task, jobs }: ProjectTask): JSX.Element => {
        const isCurrent = task.id === currentTaskId;
        const completedJobs = jobs.filter((job) => job.state === JobState.COMPLETED).length;
        const targetJob = jobs.find((job) => job.id === currentJobId) ?? jobs[0];
        const isSwitching = jobs.some((job) => job.id === switchingTo);
        const disabled = !targetJob || (switchingTo !== null && !isSwitching);

        return (
            <div
                key={task.id}
                ref={isCurrent ? currentItemRef : undefined}
                className={[
                    'cvat-project-tasks-item',
                    isCurrent ? 'cvat-project-tasks-item-current' : '',
                    disabled ? 'cvat-project-tasks-item-disabled' : '',
                ].join(' ')}
                onClick={() => { if (targetJob && !disabled) openJob(targetJob); }}
                aria-hidden
            >
                <Preview
                    task={task}
                    loadingClassName='cvat-project-tasks-item-preview-loading'
                    emptyPreviewClassName='cvat-project-tasks-item-preview-empty'
                    previewWrapperClassName='cvat-project-tasks-item-preview-wrapper'
                    previewClassName='cvat-project-tasks-item-preview'
                />
                <div className='cvat-project-tasks-item-details'>
                    <CVATTooltip overlay={task.name} placement='topLeft'>
                        <Text strong className='cvat-project-tasks-item-name'>{task.name}</Text>
                    </CVATTooltip>
                    <Text type='secondary' className='cvat-project-tasks-item-meta'>
                        {`#${task.id} · ${t('{{count}} frames', { count: task.size })}`}
                    </Text>
                    <div className='cvat-project-tasks-item-tags'>
                        {isCurrent && <Tag color='blue'>{t('Current')}</Tag>}
                        {jobs.length === 1 && (
                            <Tag color={jobStateColor(jobs[0].state)}>{translateEnum(jobs[0].state)}</Tag>
                        )}
                        {jobs.length > 1 && (
                            <Tag color={completedJobs === jobs.length ? 'success' : undefined}>
                                {t('{{completed}} of {{total}} jobs completed', {
                                    completed: completedJobs, total: jobs.length,
                                })}
                            </Tag>
                        )}
                        {!jobs.length && <Tag>{t('No jobs to annotate')}</Tag>}
                        {isSwitching && <LoadingOutlined />}
                    </div>
                    {jobs.length > 1 && (
                        <div className='cvat-project-tasks-item-jobs'>
                            {jobs.map((job) => (
                                <Tag
                                    key={job.id}
                                    color={job.id === currentJobId ? 'blue' : jobStateColor(job.state)}
                                    className='cvat-project-tasks-item-job'
                                    onClick={(event: React.MouseEvent) => {
                                        event.stopPropagation();
                                        if (!disabled) openJob(job);
                                    }}
                                >
                                    {`${job.startFrame}–${job.stopFrame}`}
                                </Tag>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <>
            <CVATTooltip overlay={t('Switch to another task of the project')}>
                <Button
                    type='link'
                    onClick={() => setOpen(true)}
                    className='cvat-annotation-header-project-tasks-button cvat-annotation-header-button'
                >
                    <AppstoreOutlined />
                    {t('Project tasks')}
                </Button>
            </CVATTooltip>
            <Drawer
                open={open}
                placement='left'
                width={380}
                className='cvat-project-tasks-drawer'
                title={projectTasks ? `${t('Project tasks')} (${projectTasks.length})` : t('Project tasks')}
                onClose={() => setOpen(false)}
            >
                <Input.Search
                    allowClear
                    className='cvat-project-tasks-search'
                    placeholder={t('Search tasks')}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                />
                {error && <Text type='danger'>{`${t('Could not load the tasks of the project')}: ${error}`}</Text>}
                {!projectTasks && fetching && <Spin className='cvat-project-tasks-spinner' />}
                {filteredTasks && (
                    filteredTasks.length ? (
                        <div className='cvat-project-tasks-list'>{filteredTasks.map(renderTask)}</div>
                    ) : <Empty description={t('No tasks found')} />
                )}
            </Drawer>
        </>
    );
}

export default React.memo(ProjectTasksDrawer);
