// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useHistory } from 'react-router';
import { InboxOutlined } from '@ant-design/icons';
import Modal from 'antd/lib/modal';
import Upload from 'antd/lib/upload';
import Input from 'antd/lib/input';
import Select from 'antd/lib/select';
import Progress from 'antd/lib/progress';
import Button from 'antd/lib/button';
import Alert from 'antd/lib/alert';
import notification from 'antd/lib/notification';
import Text from 'antd/lib/typography/Text';

import { CombinedState } from 'reducers';
import { DimensionType } from 'cvat-core-wrapper';
import {
    AUTO_FORMAT, ProjectImportStatus, importProject,
} from 'utils/project-import';
import { translateMessage } from 'utils/i18n-enums';
import { t } from 'cvat-i18n';

interface Props {
    open: boolean;
    onClose(): void;
    onImported(): void;
}

function stageText(status: ProjectImportStatus | null): string {
    const stage = status?.stage;
    if (!stage) return t('Waiting for the import to start');
    const details = { current: stage.current, total: stage.total, name: stage.name };
    switch (stage.stage) {
        case 'backup': return t('Restoring the project from the backup');
        case 'extract': return t('Extracting the archive');
        case 'task': return t('Creating task {{current}} of {{total}}: {{name}}', details);
        case 'annotations': return t('Importing annotations {{current}} of {{total}}: {{name}}', details);
        case 'dataset': return t('Importing the dataset');
        default: return '';
    }
}

function stagePercent(status: ProjectImportStatus | null): number | undefined {
    const stage = status?.stage;
    if (stage?.current && stage.total) {
        const done = stage.current - 1 + (stage.stage === 'annotations' ? 0.5 : 0);
        return Math.round((done / stage.total) * 100);
    }
    return undefined;
}

// creates a new project from an archive of annotated data (desktop build)
function ImportProjectModal(props: Readonly<Props>): JSX.Element {
    const { open, onClose, onImported } = props;
    const history = useHistory();
    const loaders = useSelector((state: CombinedState) => state.formats.annotationFormats?.loaders ?? []);

    const [file, setFile] = useState<File | null>(null);
    const [name, setName] = useState('');
    const [format, setFormat] = useState(AUTO_FORMAT);
    const [running, setRunning] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<number | null>(null);
    const [status, setStatus] = useState<ProjectImportStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    // the import continues when the dialog is closed, the result is shown in a notification
    const openRef = useRef(open);
    openRef.current = open;

    const reset = (): void => {
        setFile(null);
        setName('');
        setFormat(AUTO_FORMAT);
        setUploadProgress(null);
        setStatus(null);
        setError(null);
    };

    const start = async (): Promise<void> => {
        if (!file || running) return;
        const projectName = name.trim() || file.name.replace(/\.zip$/i, '');
        setRunning(true);
        setError(null);
        setStatus(null);
        setUploadProgress(0);
        try {
            const projectId = await importProject(file, projectName, format, setUploadProgress, setStatus);
            onImported();
            const key = `cvat-notification-project-imported-${projectId}`;
            notification.success({
                key,
                message: t('The project "{{name}}" has been imported', { name: projectName }),
                description: (
                    <Button
                        type='link'
                        className='cvat-notification-project-imported-link'
                        onClick={() => {
                            notification.destroy(key);
                            history.push(`/projects/${projectId}`);
                        }}
                    >
                        {t('Open the project')}
                    </Button>
                ),
                className: 'cvat-notification-project-imported',
            });
            reset();
            if (openRef.current) {
                onClose();
                history.push(`/projects/${projectId}`);
            }
        } catch (reason: unknown) {
            const message = reason instanceof Error ? reason.message : String(reason);
            setError(message);
            if (!openRef.current) {
                notification.error({
                    message: t('Could not import the project'),
                    description: translateMessage(message),
                    className: 'cvat-notification-project-import-failed',
                });
            }
        } finally {
            setRunning(false);
        }
    };

    const uploading = running && status === null;
    const formatOptions = [
        { value: AUTO_FORMAT, label: t('Detect automatically') },
        ...loaders
            .filter((loader: any) => loader.enabled && loader.dimension === DimensionType.DIMENSION_2D)
            .map((loader: any) => ({ value: loader.name, label: loader.name })),
    ];

    return (
        <Modal
            open={open}
            title={t('Import annotated data as a new project')}
            className='cvat-import-project-modal'
            maskClosable={!running}
            onCancel={onClose}
            footer={[
                <Button key='close' onClick={onClose}>
                    {running ? t('Continue in background') : t('Cancel')}
                </Button>,
                <Button
                    key='import'
                    type='primary'
                    disabled={!file}
                    loading={running}
                    onClick={start}
                    className='cvat-import-project-submit'
                >
                    {t('Import')}
                </Button>,
            ]}
        >
            <div className='cvat-import-project-form'>
                <Text type='secondary'>
                    {t('Supported zip archives: a project backup; a dataset exported from this application (also with video segments); videos with annotation files, every video becomes a task; a dataset with images (COCO, YOLO, PASCAL VOC, ...). Missing labels are created.')}
                </Text>
                <Upload.Dragger
                    accept='.zip'
                    disabled={running}
                    multiple={false}
                    showUploadList={false}
                    beforeUpload={(selected: File) => {
                        setFile(selected);
                        setError(null);
                        if (!name.trim() || (file && name === file.name.replace(/\.zip$/i, ''))) {
                            setName(selected.name.replace(/\.zip$/i, ''));
                        }
                        return false;
                    }}
                >
                    <p className='ant-upload-drag-icon'>
                        <InboxOutlined />
                    </p>
                    <p className='ant-upload-text'>
                        {file ? file.name : t('Click or drag a zip archive to this area')}
                    </p>
                    {file && (
                        <p className='ant-upload-hint'>{`${(file.size / (1024 * 1024)).toFixed(1)} MB`}</p>
                    )}
                </Upload.Dragger>
                <Text strong>{t('Project name')}</Text>
                <Input
                    value={name}
                    disabled={running}
                    placeholder={t('Name of the archive')}
                    onChange={(event) => setName(event.target.value)}
                    className='cvat-import-project-name'
                />
                <Text strong>{t('Annotation format')}</Text>
                <Select
                    showSearch
                    value={format}
                    disabled={running}
                    options={formatOptions}
                    onChange={setFormat}
                    className='cvat-import-project-format'
                />
                {running && (
                    <div className='cvat-import-project-progress'>
                        <Text>
                            {uploading ?
                                t('Uploading the archive') :
                                stageText(status)}
                        </Text>
                        <Progress
                            percent={uploading ?
                                Math.round((uploadProgress ?? 0) * 100) :
                                stagePercent(status)}
                            status='active'
                            showInfo={uploading || stagePercent(status) !== undefined}
                        />
                        {!uploading && status?.message && (
                            <Text type='secondary'>{translateMessage(status.message)}</Text>
                        )}
                    </div>
                )}
                {error && (
                    <Alert
                        type='error'
                        showIcon
                        message={t('Could not import the project')}
                        description={translateMessage(error)}
                    />
                )}
            </div>
        </Modal>
    );
}

export default React.memo(ImportProjectModal);
