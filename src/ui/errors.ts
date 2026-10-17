import type { MessageKey } from './i18n/messages.ts';
import type { Locale } from './i18n/messages.ts';
import type { MessageParams } from './i18n/translate.ts';
import { translate } from './i18n/translate.ts';

/** An error with a stable, translatable message key instead of a hard-coded string. */
export class UiError extends Error {
    readonly key: MessageKey;
    readonly params?: MessageParams;

    constructor(key: MessageKey, params?: MessageParams) {
        super(key);
        this.name = 'UiError';
        this.key = key;
        this.params = params;
    }
}

export function uiError(key: MessageKey, params?: MessageParams): UiError {
    return new UiError(key, params);
}

type EngineRule = { pattern: RegExp; key: MessageKey };

/**
 * The cryptographic engine keeps its messages in English because they are part of
 * the Node test surface. The UI maps the well-known failures to localized copy and
 * always keeps the raw message available as technical detail.
 */
const engineRules: readonly EngineRule[] = [
    { pattern: /wrong passphrase|could not unlock|passphrase is wrong|incorrect|decrypt failed|passphrase/i, key: 'error.engine.wrongPassphrase' },
    { pattern: /revoked/i, key: 'error.engine.revoked' },
    { pattern: /missing secret|no usable secret|without secret|dummy|secret material/i, key: 'error.engine.noSecret' },
    { pattern: /unsupported|only version 4|only version 4 ed25519|not supported|invalid key/i, key: 'error.engine.unsupported' },
    { pattern: /webgl|framebuffer|shader|context lost|gl\./i, key: 'error.engine.webgl' },
    { pattern: /search range is empty|empty after|reversed/i, key: 'error.windowEmpty' },
    { pattern: /invalid date|nonexistent|invalid clock/i, key: 'error.invalidDate' },
    { pattern: /hexadecimal|prefix/i, key: 'error.invalidPrefix' },
    { pattern: /positive integer|safe integer/i, key: 'error.positiveInteger' },
];

export type FriendlyError = { message: string; detail?: string };

export function friendlyError(error: unknown, locale: Locale): FriendlyError {
    if (error instanceof UiError) {
        return { message: translate(locale, error.key, error.params) };
    }
    const raw = error instanceof Error ? error.message : String(error);
    const rule = engineRules.find(item => item.pattern.test(raw));
    if (rule) return { message: translate(locale, rule.key), detail: raw };
    return { message: translate(locale, 'error.generic'), detail: raw };
}
