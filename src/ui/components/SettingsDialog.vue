<script setup lang="ts">
import { computed } from 'vue';
import pkg from '../../../package.json';
import { useI18n } from '../i18n/index.ts';
import { preferences, resetPreferences, updatePreferences } from '../preferences.ts';
import type { ThemeMode, ViewZone } from '../preferences-core.ts';
import { askConfirmation, pushToast } from '../store.ts';
import BaseDialog from './BaseDialog.vue';
import ComputeField from './ComputeField.vue';
import type { ComputeValue } from './ComputeField.vue';

const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();

const themes = computed(() => ([
    { value: 'auto', label: t('theme.auto') },
    { value: 'macchiato', label: t('theme.macchiato') },
    { value: 'mocha', label: t('theme.mocha') },
] as const));

const locales = computed(() => ([
    { value: 'zh-CN', label: t('locale.zh') },
    { value: 'en', label: t('locale.en') },
] as const));

const zones = computed(() => ([
    { value: 'local', label: t('common.local') },
    { value: 'utc', label: 'UTC' },
] as const));

const compute = computed<ComputeValue>(() => ({
    preset: preferences.computePreset,
    threads: preferences.threads,
    iterations: preferences.iterations,
}));

function setCompute(value: ComputeValue): void {
    updatePreferences(value);
}

async function reset(): Promise<void> {
    const confirmed = await askConfirmation({
        title: t('settings.reset'),
        message: t('settings.resetConfirm'),
        confirmLabel: t('common.reset'),
        cancelLabel: t('common.cancel'),
        danger: true,
    });
    if (!confirmed) return;
    resetPreferences();
    pushToast('success', t('toast.preferencesReset'));
}
</script>

<template>
    <BaseDialog :title="t('settings.title')" :close-label="t('common.close')" @close="emit('close')">
        <div class="settings">
            <section class="settings__section">
                <h3 class="settings__title">{{ t('settings.appearance') }}</h3>
                <div class="settings__row">
                    <span class="settings__label">{{ t('settings.theme') }}</span>
                    <div class="segmented" role="group" :aria-label="t('settings.theme')">
                        <button
                            v-for="theme in themes"
                            :key="theme.value"
                            type="button"
                            class="segmented__option"
                            :class="{ 'segmented__option--active': preferences.theme === theme.value }"
                            :aria-pressed="preferences.theme === theme.value"
                            @click="preferences.theme = theme.value as ThemeMode"
                        >
                            {{ theme.label }}
                        </button>
                    </div>
                </div>
                <p class="field__hint">{{ t('theme.autoHint') }}</p>
                <div class="settings__row">
                    <span class="settings__label">{{ t('settings.language') }}</span>
                    <div class="segmented" role="group" :aria-label="t('settings.language')">
                        <button
                            v-for="locale in locales"
                            :key="locale.value"
                            type="button"
                            class="segmented__option"
                            :class="{ 'segmented__option--active': preferences.locale === locale.value }"
                            :aria-pressed="preferences.locale === locale.value"
                            @click="preferences.locale = locale.value"
                        >
                            {{ locale.label }}
                        </button>
                    </div>
                </div>
                <div class="settings__row">
                    <span class="settings__label">{{ t('settings.displayZone') }}</span>
                    <div class="segmented" role="group" :aria-label="t('settings.displayZone')">
                        <button
                            v-for="zone in zones"
                            :key="zone.value"
                            type="button"
                            class="segmented__option"
                            :class="{ 'segmented__option--active': preferences.viewZone === zone.value }"
                            :aria-pressed="preferences.viewZone === zone.value"
                            @click="preferences.viewZone = zone.value as ViewZone"
                        >
                            {{ zone.label }}
                        </button>
                    </div>
                </div>
            </section>

            <section class="settings__section">
                <h3 class="settings__title">{{ t('settings.compute') }}</h3>
                <ComputeField :model-value="compute" :show-title="false" @update:model-value="setCompute" />
                <label class="checkbox">
                    <input v-model="preferences.soundEnabled" type="checkbox">
                    <span>{{ t('settings.sound') }}</span>
                </label>
            </section>

            <section class="settings__section">
                <p class="field__hint">{{ t('settings.storageNote') }}</p>
                <div class="btn-row">
                    <button type="button" class="btn btn--ghost btn--sm" @click="reset">
                        {{ t('settings.reset') }}
                    </button>
                </div>
            </section>

            <section class="settings__section">
                <h3 class="settings__title">{{ t('settings.about') }}</h3>
                <p class="field__hint">{{ t('settings.version', { version: pkg.version }) }}</p>
            </section>
        </div>
    </BaseDialog>
</template>
