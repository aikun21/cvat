// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useCallback, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useHistory } from 'react-router';
import { RollbackOutlined } from '@ant-design/icons';
import Button from 'antd/lib/button';

import { CombinedState } from 'reducers';
import CVATTooltip from 'components/common/cvat-tooltip';
import { saveAnnotationsAsync } from 'actions/annotation-actions';
import { t } from 'cvat-i18n';

// saves the job and returns to the page of the project the job belongs to
function BackToProjectButton(): JSX.Element | null {
    const dispatch = useDispatch();
    const history = useHistory();
    const [leaving, setLeaving] = useState(false);
    const projectId = useSelector((state: CombinedState) => state.annotation.job.instance?.projectId ?? null);
    const isSaving = useSelector((state: CombinedState) => state.annotation.annotations.saving.uploading);

    const onClick = useCallback(async (): Promise<void> => {
        if (projectId === null || isSaving || leaving) return;
        setLeaving(true);
        try {
            await dispatch(saveAnnotationsAsync());
        } catch {
            // the error is shown by the notifications, stay on the page
            setLeaving(false);
            return;
        }
        history.push(`/projects/${projectId}`);
    }, [projectId, isSaving, leaving]);

    if (projectId === null) {
        return null;
    }

    const disabled = isSaving || leaving;
    return (
        <CVATTooltip overlay={t('Save current changes and return to the project')}>
            <Button
                type='link'
                onClick={disabled ? undefined : onClick}
                className={disabled ? 'cvat-annotation-header-back-to-project-button cvat-annotation-disabled-header-button' :
                    'cvat-annotation-header-back-to-project-button cvat-annotation-header-button'}
            >
                <RollbackOutlined />
                {t('Back to project')}
            </Button>
        </CVATTooltip>
    );
}

export default React.memo(BackToProjectButton);
