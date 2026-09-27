// Copyright (C) 2022 Intel Corporation
// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import { Config } from '@react-awesome-query-builder/antd';
import asyncFetchUsers from 'components/resource-sorting-filtering/request-users';
import { t } from 'cvat-i18n';

export const config: Partial<Config> = {
    fields: {
        id: {
            label: t('ID'),
            type: 'number',
            operators: ['equal', 'between', 'greater', 'greater_or_equal', 'less', 'less_or_equal'],
            fieldSettings: { min: 0 },
            valueSources: ['value'],
        },
        name: {
            label: t('Name'),
            type: 'text',
            valueSources: ['value'],
            operators: ['like'],
        },
        assignee: {
            label: t('Assignee'),
            type: 'select',
            valueSources: ['value'],
            operators: ['select_equals'],
            fieldSettings: {
                useAsyncSearch: true,
                forceAsyncSearch: true,
                asyncFetch: asyncFetchUsers,
            },
        },
        owner: {
            label: t('Owner'),
            type: 'select',
            valueSources: ['value'],
            operators: ['select_equals'],
            fieldSettings: {
                useAsyncSearch: true,
                forceAsyncSearch: true,
                asyncFetch: asyncFetchUsers,
            },
        },
        updated_date: {
            label: t('Last updated'),
            type: 'datetime',
            operators: ['between', 'greater', 'greater_or_equal', 'less', 'less_or_equal'],
        },
        status: {
            label: t('Status'),
            type: 'select',
            valueSources: ['value'],
            operators: ['select_equals', 'select_any_in', 'select_not_any_in'],
            fieldSettings: {
                listValues: [
                    { value: 'annotation', title: t('Annotation') },
                    { value: 'validation', title: t('Validation') },
                    { value: 'completed', title: t('Completed') },
                ],
            },
        },
    },
};

export const localStorageRecentCapacity = 10;
export const localStorageRecentKeyword = 'recentlyAppliedProjectsFilters';
export const predefinedFilterValues = {
    'Assigned to me': '{"and":[{"==":[{"var":"assignee"},"<username>"]}]}',
    'Owned by me': '{"and":[{"==":[{"var":"owner"},"<username>"]}]}',
    'Not completed': '{"!":{"and":[{"==":[{"var":"status"},"completed"]}]}}',
};
