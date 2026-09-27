// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useState } from 'react';
import notification from 'antd/lib/notification';
import Text from 'antd/lib/typography/Text';
import SelectCloudStorage from 'components/select-cloud-storage/select-cloud-storage';
import {
    getCore, FramesMetaData, StorageLocation, CloudStorage,
} from 'cvat-core-wrapper';
import { t } from 'cvat-i18n';

interface Props {
    taskMeta: FramesMetaData,
    cloudStorageInstance: CloudStorage,
    onUpdateTaskMeta: (meta: FramesMetaData) => Promise<void>;
}

export async function getCloudStorageById(id: number): Promise<CloudStorage | null> {
    try {
        const [data] = await getCore().cloudStorages.get({ id });
        return data;
    } catch (error: any) {
        notification.error({
            message: t('Could not fetch a cloud storage'),
            description: error.toString(),
        });
    }
    return null;
}

export default function CloudStorageEditorComponent(props: Props): JSX.Element | null {
    const { taskMeta, cloudStorageInstance, onUpdateTaskMeta } = props;

    const [searchPhrase, setSearchPhrase] = useState(cloudStorageInstance ? cloudStorageInstance.displayName : '');

    const label = <Text type='secondary'>{t('Cloud storage')}</Text>;

    if (taskMeta.storage !== StorageLocation.CLOUD_STORAGE) {
        return null;
    }

    return (
        <SelectCloudStorage
            searchPhrase={searchPhrase}
            cloudStorage={cloudStorageInstance}
            setSearchPhrase={setSearchPhrase}
            onSelectCloudStorage={(_cloudStorage: CloudStorage | null) => {
                if (_cloudStorage) {
                    taskMeta.cloudStorageId = _cloudStorage.id;
                    onUpdateTaskMeta(taskMeta);
                } else {
                    setSearchPhrase(cloudStorageInstance ? cloudStorageInstance.displayName : '');
                }
            }}
            label={label}
        />
    );
}
