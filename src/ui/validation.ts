import { uiError } from './errors.ts';
import { normalizeFingerprint } from './format.ts';

/** Returns the normalized prefix; throws a translatable UI error when invalid. */
export function validatePrefix(prefix: string): string {
    const normalized = prefix.replace(/\s+/g, '').toUpperCase();
    if (!/^[0-9A-F]{1,40}$/.test(normalized)) throw uiError('error.invalidPrefix');
    return normalized;
}

export function validatePositiveInteger(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) throw uiError('error.positiveInteger');
    return parsed;
}

export function validateNonNegativeInteger(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw uiError('error.positiveInteger');
    return parsed;
}

export function validateProtection(passphrase: string, confirmation: string, allowUnprotected: boolean): { passphrase: string; allowUnprotected: boolean } {
    if (passphrase !== confirmation) throw uiError('error.passphraseMismatch');
    if (!passphrase && !allowUnprotected) throw uiError('error.passphraseRequired');
    return { passphrase, allowUnprotected };
}

export function validateExpiration(expiresAt: Date | null, now: Date): Date | null {
    if (expiresAt && expiresAt.getTime() <= now.getTime()) throw uiError('error.expiryPast');
    return expiresAt;
}

export function validateFingerprintSelection(fingerprints: readonly string[]): string[] {
    if (fingerprints.length === 0) throw uiError('error.selectionRequired');
    const normalized = fingerprints.map(normalizeFingerprint);
    if (normalized.some(fingerprint => !/^[0-9A-F]{40}$/.test(fingerprint))) {
        throw uiError('error.selectionRequired');
    }
    if (new Set(normalized).size !== normalized.length) throw uiError('error.selectionRequired');
    return normalized;
}
