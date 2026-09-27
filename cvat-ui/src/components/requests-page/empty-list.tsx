// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React from 'react';
import Text from 'antd/lib/typography/Text';
import { Row, Col } from 'antd/lib/grid';
import Empty from 'antd/lib/empty';
import { t } from 'cvat-i18n';

export default function EmptyListComponent(): JSX.Element {
    return (
        <div className='cvat-empty-requests-list'>
            <Empty description={(
                <>
                    <Row justify='center' align='middle'>
                        <Col>
                            <Text strong>{t('No requests made yet ...')}</Text>
                        </Col>
                    </Row>
                    <Row justify='center' align='middle'>
                        <Col>
                            <Text type='secondary'>{t('Start importing/exporting your resources to see progress here')}</Text>
                        </Col>
                    </Row>
                </>
            )}
            />
        </div>
    );
}
