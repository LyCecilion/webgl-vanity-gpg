<script setup lang="ts">
import { computed } from 'vue';
import { friendlyError } from '../errors.ts';
import { formatDateInput, localTimeZoneName } from '../format.ts';
import { useI18n } from '../i18n/index.ts';
import { describeWindow, resolveWindow } from '../window.ts';
import type { TimeWindowValue } from '../window.ts';

const props = defineProps<{
    idPrefix: string;
    modelValue: TimeWindowValue;
    notBefore?: Date;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: TimeWindowValue] }>();
const { t, locale } = useI18n();

const modes = computed(() => ([
    { value: 'today', label: t('create.window.mode.today') },
    { value: 'day', label: t('create.window.mode.day') },
    { value: 'range', label: t('create.window.mode.range') },
] as const));

const preview = computed(() => {
    try {
        const now = new Date();
        const range = resolveWindow(props.modelValue, now, props.notBefore);
        return { text: describeWindow(range, props.modelValue.zone, now, props.notBefore, locale.value), error: '' };
    } catch (error) {
        return { text: '', error: friendlyError(error, locale.value).message };
    }
});

function patch(change: Partial<TimeWindowValue>): void {
    emit('update:modelValue', { ...props.modelValue, ...change });
}

function setMode(mode: TimeWindowValue['mode']): void {
    if (mode === 'day' && !props.modelValue.date) {
        patch({ mode, date: formatDateInput(Date.now(), props.modelValue.zone) });
        return;
    }
    patch({ mode });
}
</script>

<template>
    <div class="field">
        <span class="field__label">{{ t('create.window.title') }}</span>
        <div class="segmented" role="group" :aria-label="t('create.window.title')">
            <button
                v-for="mode in modes"
                :key="mode.value"
                type="button"
                class="segmented__option"
                :class="{ 'segmented__option--active': modelValue.mode === mode.value }"
                :aria-pressed="modelValue.mode === mode.value"
                @click="setMode(mode.value)"
            >
                {{ mode.label }}
            </button>
        </div>

        <div v-if="modelValue.mode !== 'today'" class="grid-2" style="margin-top: var(--space-3)">
            <div v-if="modelValue.mode === 'day'" class="field" style="margin-bottom: 0">
                <label class="field__label" :for="`${idPrefix}-day`">{{ t('create.window.day') }}</label>
                <input
                    :id="`${idPrefix}-day`"
                    class="input"
                    type="date"
                    :value="modelValue.date"
                    @input="patch({ date: ($event.target as HTMLInputElement).value })"
                >
            </div>
            <template v-else>
                <div class="field" style="margin-bottom: 0">
                    <label class="field__label" :for="`${idPrefix}-start`">{{ t('create.window.start') }}</label>
                    <input
                        :id="`${idPrefix}-start`"
                        class="input"
                        type="datetime-local"
                        step="1"
                        :value="modelValue.rangeStart"
                        @input="patch({ rangeStart: ($event.target as HTMLInputElement).value })"
                    >
                </div>
                <div class="field" style="margin-bottom: 0">
                    <label class="field__label" :for="`${idPrefix}-end`">{{ t('create.window.end') }}</label>
                    <input
                        :id="`${idPrefix}-end`"
                        class="input"
                        type="datetime-local"
                        step="1"
                        :value="modelValue.rangeEnd"
                        @input="patch({ rangeEnd: ($event.target as HTMLInputElement).value })"
                    >
                </div>
            </template>
        </div>

        <div class="field" style="margin-top: var(--space-3); margin-bottom: 0">
            <label class="field__label" :for="`${idPrefix}-zone`">{{ t('create.window.zone') }}</label>
            <select
                :id="`${idPrefix}-zone`"
                class="select"
                :value="modelValue.zone"
                @change="patch({ zone: ($event.target as HTMLSelectElement).value as TimeWindowValue['zone'] })"
            >
                <option value="local">{{ t('common.local') }}（{{ localTimeZoneName() }}）</option>
                <option value="utc">UTC</option>
            </select>
        </div>

        <p v-if="preview.error" class="field__error">{{ preview.error }}</p>
        <p v-else class="progress__window">{{ preview.text }}</p>
        <p class="field__hint">{{ t('create.window.primaryNote') }}</p>
        <p v-if="notBefore" class="field__hint">
            {{ t('add.window.note') }}（{{ modelValue.zone === 'utc' ? 'UTC' : localTimeZoneName() }}）
        </p>
    </div>
</template>
