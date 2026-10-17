<script setup lang="ts">
import { computed, ref } from 'vue';
import { formatRate } from '../format.ts';
import { useI18n } from '../i18n/index.ts';
import { benchmarkGpu } from '../operations.ts';
import { AUTO_COMPUTE, COMPUTE_PRESETS, computePreferencePatch } from '../preferences-core.ts';
import type { ComputePreset } from '../preferences-core.ts';
import { preferences, updatePreferences } from '../preferences.ts';
import { operation, pushToast, toastError } from '../store.ts';

export type ComputeValue = { preset: ComputePreset; threads: number; iterations: number };

const props = withDefaults(defineProps<{ modelValue: ComputeValue; showTitle?: boolean }>(), { showTitle: true });
const emit = defineEmits<{ 'update:modelValue': [value: ComputeValue] }>();
const { t } = useI18n();

const benchmarking = ref(false);

const presets = computed(() => ([
    { value: 'auto', label: t('create.compute.presetAuto') },
    { value: 'fast', label: t('create.compute.presetFast') },
    { value: 'light', label: t('create.compute.presetLight') },
    { value: 'custom', label: t('create.compute.presetCustom') },
] as const));

const rateText = computed(() => preferences.measuredRate
    ? t('create.compute.rate', { rate: formatRate(preferences.measuredRate) })
    : t('create.compute.rateUnknown'));

function apply(next: ComputeValue): void {
    emit('update:modelValue', next);
    updatePreferences(computePreferencePatch(next));
}

function setPreset(preset: ComputePreset): void {
    if (preset === 'custom') {
        apply({ ...props.modelValue, preset });
        return;
    }
    const values = preset === 'auto' ? { ...AUTO_COMPUTE } : { ...COMPUTE_PRESETS[preset] };
    apply({ preset, ...values });
}

function setNumber(field: 'threads' | 'iterations', event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    apply({ ...props.modelValue, preset: 'custom', [field]: Number.isFinite(value) ? value : 0 });
}

async function benchmark(): Promise<void> {
    if (benchmarking.value || operation.active) return;
    benchmarking.value = true;
    try {
        const rate = await benchmarkGpu(props.modelValue.threads, props.modelValue.iterations);
        if (rate) pushToast('success', t('toast.benchmarkDone'));
        else toastError(new Error('The benchmark could not measure a WebGL hash rate.'));
    } catch (error) {
        toastError(error);
    } finally {
        benchmarking.value = false;
    }
}
</script>

<template>
    <div class="field">
        <span v-if="showTitle" class="field__label">{{ t('create.compute.title') }}</span>
        <div class="segmented" role="group" :aria-label="t('create.compute.preset')">
            <button
                v-for="preset in presets"
                :key="preset.value"
                type="button"
                class="segmented__option"
                :class="{ 'segmented__option--active': modelValue.preset === preset.value }"
                :aria-pressed="modelValue.preset === preset.value"
                @click="setPreset(preset.value)"
            >
                {{ preset.label }}
            </button>
        </div>

        <div class="grid-2" style="margin-top: var(--space-3)">
            <div class="field" style="margin-bottom: 0">
                <label class="field__label" for="compute-threads">{{ t('create.compute.threads') }}</label>
                <input
                    id="compute-threads"
                    class="input mono"
                    type="number"
                    min="1"
                    step="1"
                    :value="modelValue.threads"
                    @change="setNumber('threads', $event)"
                >
            </div>
            <div class="field" style="margin-bottom: 0">
                <label class="field__label" for="compute-iterations">{{ t('create.compute.iterations') }}</label>
                <input
                    id="compute-iterations"
                    class="input mono"
                    type="number"
                    min="1"
                    step="1"
                    :value="modelValue.iterations"
                    @change="setNumber('iterations', $event)"
                >
            </div>
        </div>

        <div class="inline-row">
            <button
                type="button"
                class="btn btn--secondary btn--sm"
                :disabled="benchmarking || operation.active"
                @click="benchmark"
            >
                {{ benchmarking ? t('create.compute.benchmarking') : t('create.compute.benchmark') }}
            </button>
            <span class="muted" style="font-size: var(--text-xs)">{{ rateText }}</span>
        </div>
        <p class="field__hint">{{ t('create.compute.hint') }}</p>
    </div>
</template>
