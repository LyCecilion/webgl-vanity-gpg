import type { Locale } from './i18n/messages.ts';

export type ThemeMode = 'auto' | 'macchiato' | 'mocha';
export type ComputePreset = 'auto' | 'fast' | 'light' | 'custom';
export type ViewZone = 'local' | 'utc';

/**
 * Non-sensitive preferences only. Keys, passphrases, fingerprints, and certificate
 * data must never be added to this object.
 */
export type Preferences = {
    version: 1;
    locale: Locale;
    theme: ThemeMode;
    viewZone: ViewZone;
    computePreset: ComputePreset;
    threads: number;
    iterations: number;
    soundEnabled: boolean;
    /** Last measured GPU hash rate, used only for search-time estimates. */
    measuredRate: number | null;
};

export const STORAGE_KEY = 'webgl-vanity-gpg.preferences.v1';

export const COMPUTE_PRESETS: Readonly<Record<Exclude<ComputePreset, 'auto' | 'custom'>, { threads: number; iterations: number }>> = {
    fast: { threads: 131072, iterations: 8 },
    light: { threads: 16384, iterations: 4 },
};

export const AUTO_COMPUTE = { threads: 65536, iterations: 8 } as const;

export const defaultPreferences: Preferences = {
    version: 1,
    locale: 'zh-CN',
    theme: 'auto',
    viewZone: 'local',
    computePreset: 'auto',
    threads: AUTO_COMPUTE.threads,
    iterations: AUTO_COMPUTE.iterations,
    soundEnabled: false,
    measuredRate: null,
};

const locales: readonly string[] = ['zh-CN', 'en'];
const themes: readonly string[] = ['auto', 'macchiato', 'mocha'];
const presets: readonly string[] = ['auto', 'fast', 'light', 'custom'];
const zones: readonly string[] = ['local', 'utc'];

function pick<T extends string>(allowed: readonly string[], value: unknown, fallback: T): T {
    return typeof value === 'string' && allowed.includes(value) ? value as T : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/** Coerce arbitrary parsed JSON into a safe, fully populated preference object. */
export function normalizePreferences(input: unknown): Preferences {
    const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    const rate = source.measuredRate;
    return {
        version: 1,
        locale: pick(locales, source.locale, defaultPreferences.locale),
        theme: pick(themes, source.theme, defaultPreferences.theme),
        viewZone: pick(zones, source.viewZone, defaultPreferences.viewZone),
        computePreset: pick(presets, source.computePreset, defaultPreferences.computePreset),
        threads: positiveInteger(source.threads, defaultPreferences.threads),
        iterations: positiveInteger(source.iterations, defaultPreferences.iterations),
        soundEnabled: source.soundEnabled === true,
        measuredRate: typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : null,
    };
}

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem' | 'removeItem'>;

export function loadPreferences(storage: ReadableStorage | undefined): Preferences {
    if (!storage) return { ...defaultPreferences };
    try {
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return { ...defaultPreferences };
        return normalizePreferences(JSON.parse(raw));
    } catch {
        return { ...defaultPreferences };
    }
}

export function savePreferences(storage: WritableStorage | undefined, preferences: Preferences): void {
    if (!storage) return;
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
        // A full or blocked storage must never break the application.
    }
}

export function clearPreferences(storage: WritableStorage | undefined): void {
    if (!storage) return;
    try {
        storage.removeItem(STORAGE_KEY);
    } catch {
        // Ignore storage failures.
    }
}

/** Resolve the compute preset into concrete thread/iteration values. */
export function computeValues(preferences: Preferences): { threads: number; iterations: number } {
    if (preferences.computePreset === 'auto') return { ...AUTO_COMPUTE };
    if (preferences.computePreset === 'custom') {
        return { threads: preferences.threads, iterations: preferences.iterations };
    }
    return { ...COMPUTE_PRESETS[preferences.computePreset] };
}
