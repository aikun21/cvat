// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React from 'react';
import Select from 'antd/lib/select';
import { JobStage, JobState } from 'cvat-core-wrapper';
import { handleDropdownKeyDown } from 'utils/dropdown-utils';
import { t } from 'cvat-i18n';
import { translateEnum } from 'utils/i18n-enums';

interface JobStateSelectorProps {
    value: JobState | null;
    onSelect: (newValue: JobState) => void;
}

export function JobStateSelector({ value, onSelect }: Readonly<JobStateSelectorProps>): JSX.Element {
    return (
        <Select
            className='cvat-job-item-state'
            popupClassName='cvat-job-item-state-dropdown'
            value={value}
            onChange={onSelect}
            onKeyDown={handleDropdownKeyDown}
            placeholder={t('Select a state')}
        >
            <Select.Option value={JobState.NEW}>{translateEnum(JobState.NEW)}</Select.Option>
            <Select.Option value={JobState.IN_PROGRESS}>{translateEnum(JobState.IN_PROGRESS)}</Select.Option>
            <Select.Option value={JobState.REJECTED}>{translateEnum(JobState.REJECTED)}</Select.Option>
            <Select.Option value={JobState.COMPLETED}>{translateEnum(JobState.COMPLETED)}</Select.Option>
        </Select>
    );
}

interface JobStageSelectorProps {
    value: JobStage | null;
    onSelect: (newValue: JobStage) => void;
}

export function JobStageSelector({ value, onSelect }: Readonly<JobStageSelectorProps>): JSX.Element {
    return (
        <Select
            className='cvat-job-item-stage'
            popupClassName='cvat-job-item-stage-dropdown'
            value={value}
            onChange={onSelect}
            onKeyDown={handleDropdownKeyDown}
            placeholder={t('Select a stage')}
        >
            <Select.Option value={JobStage.ANNOTATION}>
                {translateEnum(JobStage.ANNOTATION)}
            </Select.Option>
            <Select.Option value={JobStage.VALIDATION}>
                {translateEnum(JobStage.VALIDATION)}
            </Select.Option>
            <Select.Option value={JobStage.ACCEPTANCE}>
                {translateEnum(JobStage.ACCEPTANCE)}
            </Select.Option>
        </Select>
    );
}
