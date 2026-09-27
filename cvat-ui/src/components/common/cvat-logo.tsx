// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React from 'react';
import { useSelector } from 'react-redux';
import { CombinedState } from 'reducers';
import { t } from 'cvat-i18n';

function CVATLogo(): JSX.Element {
    const logo = useSelector((state: CombinedState) => state.about.server.logoURL);

    return (
        <div className='cvat-logo-icon'>
            <img src={logo} alt={t('CVAT Logo')} />
        </div>
    );
}

export default React.memo(CVATLogo);
