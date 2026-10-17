import { reactive, watch } from 'vue';
import { detectLocale } from './i18n/translate.ts';
import {
    clearPreferences,
    defaultPreferences,
    loadPreferences,
    normalizePreferences,
    savePreferences,
    STORAGE_KEY,
} from './preferences-core.ts';
import type { Preferences } from './preferences-core.ts';

function browserStorage(): Storage | undefined {
    try {
        return window.localStorage;
    } catch {
        return undefined;
    }
}

const storage = browserStorage();
const hasStoredPreferences = (() => {
    try {
        return Boolean(storage?.getItem(STORAGE_KEY));
    } catch {
        return false;
    }
})();

const initial: Preferences = hasStoredPreferences
    ? loadPreferences(storage)
    : { ...defaultPreferences, locale: detectLocale(navigator.languages) };

export const preferences = reactive<Preferences>(initial);

watch(preferences, () => savePreferences(storage, preferences), { deep: true });

export function resetPreferences(): void {
    clearPreferences(storage);
    Object.assign(preferences, normalizePreferences(defaultPreferences));
}

/** Persist a preference patch while keeping the reactive object as the single source. */
export function updatePreferences(patch: Partial<Preferences>): void {
    Object.assign(preferences, normalizePreferences({ ...preferences, ...patch }));
}
