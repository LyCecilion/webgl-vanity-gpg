import test from 'node:test';
import assert from 'node:assert/strict';
import {
    AUTO_COMPUTE,
    clearPreferences,
    computeValues,
    defaultPreferences,
    loadPreferences,
    normalizePreferences,
    savePreferences,
    STORAGE_KEY,
} from '../src/ui/preferences-core.ts';
import type { Preferences } from '../src/ui/preferences-core.ts';

function fakeStorage() {
    const data = new Map<string, string>();
    return {
        data,
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => { data.set(key, value); },
        removeItem: (key: string) => { data.delete(key); },
    };
}

test('invalid preference payloads fall back to safe defaults', () => {
    const normalized = normalizePreferences({
        locale: 'fr',
        theme: 'neon',
        viewZone: 'mars',
        computePreset: 'turbo',
        threads: -5,
        iterations: 0,
        soundEnabled: 'yes',
        measuredRate: -1,
        privateKey: 'must not be read',
    });
    assert.deepEqual(normalized, defaultPreferences);
});

test('valid preferences round-trip through storage and unknown keys are dropped', () => {
    const storage = fakeStorage();
    const preferences: Preferences = {
        ...defaultPreferences,
        locale: 'en',
        theme: 'mocha',
        viewZone: 'utc',
        computePreset: 'custom',
        threads: 32768,
        iterations: 4,
        soundEnabled: true,
        measuredRate: 12_345_678,
    };
    savePreferences(storage, preferences);
    const raw = JSON.parse(storage.data.get(STORAGE_KEY) as string) as Record<string, unknown>;
    assert.deepEqual(Object.keys(raw).sort(), Object.keys(defaultPreferences).sort());
    assert.deepEqual(loadPreferences(storage), preferences);
    clearPreferences(storage);
    assert.deepEqual(loadPreferences(storage), defaultPreferences);
});

test('storage failures never throw', () => {
    const broken = {
        getItem: () => { throw new Error('blocked'); },
        setItem: () => { throw new Error('blocked'); },
        removeItem: () => { throw new Error('blocked'); },
    };
    assert.deepEqual(loadPreferences(broken), defaultPreferences);
    assert.doesNotThrow(() => savePreferences(broken, defaultPreferences));
    assert.doesNotThrow(() => clearPreferences(broken));
    assert.deepEqual(loadPreferences(undefined), defaultPreferences);
});

test('compute presets resolve to concrete values', () => {
    const base: Preferences = { ...defaultPreferences, computePreset: 'fast' };
    assert.deepEqual(computeValues(base), { threads: 131072, iterations: 8 });
    assert.deepEqual(computeValues({ ...base, computePreset: 'light' }), { threads: 16384, iterations: 4 });
    assert.deepEqual(computeValues({ ...base, computePreset: 'auto' }), { ...AUTO_COMPUTE });
    assert.deepEqual(computeValues({ ...base, computePreset: 'custom', threads: 4096, iterations: 3 }), { threads: 4096, iterations: 3 });
});
