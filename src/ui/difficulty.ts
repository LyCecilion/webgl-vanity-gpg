import type { MessageKey } from './i18n/messages.ts';

export type DifficultyCategory = 'instant' | 'seconds' | 'minutes' | 'hours' | 'days' | 'infeasible';

/** Expected number of hashes for a random prefix of `prefixLength` nibbles. */
export function expectedHashes(prefixLength: number): bigint {
    if (!Number.isInteger(prefixLength) || prefixLength < 1 || prefixLength > 40) {
        throw new Error('A vanity prefix length must be an integer between 1 and 40.');
    }
    return 16n ** BigInt(prefixLength);
}

/** Seconds implied by the measured rate, or null when no rate is known yet. */
export function estimateSeconds(expected: bigint, rate: number | null): number | null {
    if (!rate || !Number.isFinite(rate) || rate <= 0) return null;
    const seconds = Number(expected) / rate;
    return Number.isFinite(seconds) ? seconds : null;
}

export function difficultyCategory(expected: bigint, rate: number | null): DifficultyCategory {
    const seconds = estimateSeconds(expected, rate);
    if (seconds !== null) {
        if (seconds <= 1) return 'instant';
        if (seconds <= 60) return 'seconds';
        if (seconds <= 3600) return 'minutes';
        if (seconds <= 86400) return 'hours';
        if (seconds <= 86400 * 30) return 'days';
        return 'infeasible';
    }
    // Without a measured rate, fall back to hard-coded prefix-length bands.
    if (expected <= 16n ** 4n) return 'instant';
    if (expected <= 16n ** 6n) return 'seconds';
    if (expected <= 16n ** 8n) return 'minutes';
    if (expected <= 16n ** 10n) return 'hours';
    if (expected <= 16n ** 12n) return 'days';
    return 'infeasible';
}

/** Chance that at least one hit occurred after `hashes` attempts. */
export function hitProbability(expected: bigint, hashes: number): number {
    const numeric = Number(expected);
    if (!Number.isFinite(numeric) || numeric <= 0 || hashes <= 0) return 0;
    return Math.min(1, 1 - Math.exp(-hashes / numeric));
}

/** Expected number of fresh key materials needed for a given window length. */
export function expectedMaterials(expected: bigint, windowLength: number): number {
    if (!Number.isFinite(windowLength) || windowLength <= 0) return Number.POSITIVE_INFINITY;
    return Math.ceil(Number(expected) / windowLength);
}

export const difficultyCategoryKeys: Record<DifficultyCategory, MessageKey> = {
    instant: 'difficulty.instant',
    seconds: 'difficulty.seconds',
    minutes: 'difficulty.minutes',
    hours: 'difficulty.hours',
    days: 'difficulty.days',
    infeasible: 'difficulty.infeasible',
};
