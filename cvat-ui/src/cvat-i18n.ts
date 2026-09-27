// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

// UI localization. English source strings are used as keys, so any string
// without a translation falls back to the original English text.
// The language is chosen once at startup, which is why a plain `t` function
// (instead of a React hook) is enough everywhere, including reducers/actions.

import i18next from 'i18next';
import zhCN from './locales/zh-CN.json';

export const DEFAULT_LANGUAGE = 'zh-CN';
const LANGUAGE_STORAGE_KEY = 'cvat-ui-language';

function detectLanguage(): string {
    try {
        return localStorage.getItem(LANGUAGE_STORAGE_KEY) || DEFAULT_LANGUAGE;
    } catch {
        return DEFAULT_LANGUAGE;
    }
}

i18next.init({
    lng: detectLanguage(),
    fallbackLng: false,
    resources: {
        'zh-CN': { translation: zhCN },
    },
    // keys are natural-language sentences which may contain '.' and ':'
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    returnEmptyString: false,
    // resources are bundled, so initialization is synchronous
    initAsync: false,
});

export const language = i18next.language;
export const isChinese = language.startsWith('zh');

// Placeholders that receive resource words like 'task' or 'dataset' ("Export {{instanceType}} as a dataset").
// Their values are translated too, so they read naturally inside translated sentences.
// The words themselves are listed in utils/i18n-enums.ts.
const TRANSLATED_PLACEHOLDERS = new Set([
    'instanceType', 'newInstanceType', 'resource', 'resToPrint', 'annotationEntity', 'resourceName',
]);

export function t(key: string, options?: Record<string, unknown>): string {
    if (options) {
        const translated: Record<string, unknown> = { ...options };
        for (const [name, value] of Object.entries(options)) {
            if (TRANSLATED_PLACEHOLDERS.has(name) && typeof value === 'string') {
                translated[name] = i18next.t(value);
            }
        }
        return i18next.t(key, translated) as string;
    }
    return i18next.t(key) as string;
}

export function setLanguage(lng: string): void {
    try {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
    } catch {
        // storage may be unavailable; the default language is used then
    }
    window.location.reload();
}
