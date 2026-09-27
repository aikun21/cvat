// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React from 'react';
import { t } from 'cvat-i18n';

interface NameTemplateTooltipProps {
    example: string;
}

function NameTemplateTooltip({ example }: NameTemplateTooltipProps) {
    return (
        <>
            {t('You can use the template:')}
            <ul style={{ marginBottom: 0 }}>
                <li>
                    <code>{'{{id}}'}</code>
                    <br />
                    {t('- resource id')}
                </li>
                <li>
                    <code>{'{{name}}'}</code>
                    <br />
                    {t('- resource name')}
                </li>
                <li>
                    <code>{'{{index}}'}</code>
                    <br />
                    {t('- index in selection')}
                </li>
            </ul>
            <div>
                {t('Example:')}
                <br />
                <i>{example}</i>
            </div>
        </>
    );
}

export default React.memo(NameTemplateTooltip);
