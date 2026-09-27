// Copyright (C) 2021-2022 Intel Corporation
// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import { t } from 'cvat-i18n';
const validationPatterns = {
    validatePasswordLength: {
        pattern: /^(?=.{8,256}$)/,
        message: t('Password must be between 8 and 256 characters'),
    },

    passwordContainsNumericCharacters: {
        pattern: /(?=.*[0-9])/,
        message: t('Password must have at least 1 numeric characters'),
    },

    passwordContainsUpperCaseCharacter: {
        pattern: /(?=.*[A-Z])/,
        message: t('Password must have at least 1 uppercase alphabetical character'),
    },

    passwordContainsLowerCaseCharacter: {
        pattern: /(?=.*[a-z])/,
        message: t('Password must have at least 1 lowercase alphabetical character'),
    },

    validateUsernameLength: {
        pattern: /^.{5,150}$/u,
        message: t('Username must be between 5 and 150 characters'),
    },

    validateUsernameCharacters: {
        pattern: /^[\p{L}\p{N}_@.+-]+$/u,
        message: t('Only letters, numbers, and @/./+/-/_ characters are available'),
    },

    /*
        \p{Pd} - dash connectors
        \p{Pc} - connector punctuations
        \p{Cf} - invisible formatting indicator
        \p{L} - any alphabetic character
        Useful links:
        https://stackoverflow.com/questions/4323386/multi-language-input-validation-with-utf-8-encoding
        https://stackoverflow.com/questions/280712/javascript-unicode-regexes
        https://stackoverflow.com/questions/6377407/how-to-validate-both-chinese-unicode-and-english-name
    */
    validateName: {

        pattern: /^(\p{L}|\p{Pd}|\p{Cf}|\p{Pc}|['\s]){2,}$/gu,
        message: t('Invalid name'),
    },

    validateAttributeName: {
        pattern: /\S+/,
        message: t('Invalid name'),
    },

    validateLabelName: {
        pattern: /\S+/,
        message: t('Invalid name'),
    },

    validateAttributeValue: {
        pattern: /\S+/,
        message: t('Invalid attribute value'),
    },

    validateURL: {

        pattern: /^(https?:\/\/)[^\s$.?#].[^\s]*$/, // url, ip
        message: t('URL is not valid'),
    },

    validateOrganizationSlug: {
        pattern: /^[a-zA-Z\d]+$/,
        message: t('Only Latin characters and numbers are allowed'),
    },

    validatePhoneNumber: {
        pattern: /^[+]*[-\s0-9]*$/g,
        message: t('Input phone number is not correct'),
    },
};

export default validationPatterns;
