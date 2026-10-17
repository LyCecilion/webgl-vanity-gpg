import { catalogs } from './messages.ts';
import type { Locale, MessageKey } from './messages.ts';

export type MessageParams = Record<string, string | number>;

/**
 * Pure translation helper: `{name}` placeholders are replaced from `params`.
 * Unknown placeholders are left untouched so a catalog typo is visible instead
 * of silently rendering an empty string.
 */
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
    const template = catalogs[locale][key] ?? catalogs['zh-CN'][key] ?? key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
        const value = params[name];
        return value === undefined ? match : String(value);
    });
}

export function detectLocale(languages: readonly string[] | undefined): Locale {
    const first = languages?.[0]?.toLowerCase() ?? '';
    return first.startsWith('zh') ? 'zh-CN' : 'en';
}
