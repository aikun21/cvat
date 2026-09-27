// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import './styles.scss';

import React from 'react';
import { useHistory } from 'react-router';
import { Row, Col } from 'antd/lib/grid';
import Text from 'antd/lib/typography/Text';
import Button from 'antd/lib/button';
import { t } from 'cvat-i18n';

interface Props {
    instanceType: 'task' | 'project';
    id: number;
}

function MdGuideControl(props: Props): JSX.Element {
    const { instanceType, id } = props;
    const history = useHistory();

    return (
        <Row justify='start' className='cvat-md-guide-control-wrapper'>
            <Col span={24}>
                <Text strong className='cvat-text-color'>{instanceType === 'project' ? t('Project description') : t('Task description')}</Text>
                <br />
                <Button
                    onClick={() => {
                        history.push(`/${instanceType}s/${id}/guide`);
                    }}
                >
                    {t('Edit')}
                </Button>
            </Col>
        </Row>
    );
}

export default React.memo(MdGuideControl);
