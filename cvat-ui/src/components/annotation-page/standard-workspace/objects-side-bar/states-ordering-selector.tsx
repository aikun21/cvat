// Copyright (C) 2020-2022 Intel Corporation
// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React from 'react';
import { Col } from 'antd/lib/grid';
import Select from 'antd/lib/select';
import Text from 'antd/lib/typography/Text';
import { translateEnum } from 'utils/i18n-enums';

import { StatesOrdering } from 'reducers';
import { t } from 'cvat-i18n';

interface StatesOrderingSelectorComponentProps {
    statesOrdering: StatesOrdering;
    changeStatesOrdering(value: StatesOrdering): void;
}

function StatesOrderingSelectorComponent(props: StatesOrderingSelectorComponentProps): JSX.Element {
    const { statesOrdering, changeStatesOrdering } = props;

    return (
        <Col>
            <Text>{t('Sort by')}</Text>
            <Select
                size='small'
                className='cvat-objects-sidebar-ordering-selector'
                popupClassName='cvat-objects-sidebar-ordering-dropdown'
                value={statesOrdering}
                onChange={changeStatesOrdering}
            >
                <Select.Option key={StatesOrdering.ID_DESCENT} value={StatesOrdering.ID_DESCENT}>
                    {translateEnum(StatesOrdering.ID_DESCENT)}
                </Select.Option>
                <Select.Option key={StatesOrdering.ID_ASCENT} value={StatesOrdering.ID_ASCENT}>
                    {translateEnum(StatesOrdering.ID_ASCENT)}
                </Select.Option>
                <Select.Option key={StatesOrdering.UPDATED} value={StatesOrdering.UPDATED}>
                    {translateEnum(StatesOrdering.UPDATED)}
                </Select.Option>
                <Select.Option key={StatesOrdering.LAYER} value={StatesOrdering.LAYER}>
                    {translateEnum(StatesOrdering.LAYER)}
                </Select.Option>
                <Select.Option key={StatesOrdering.LABEL_NAME} value={StatesOrdering.LABEL_NAME}>
                    {translateEnum(StatesOrdering.LABEL_NAME)}
                </Select.Option>
            </Select>
        </Col>
    );
}

export default React.memo(StatesOrderingSelectorComponent);
