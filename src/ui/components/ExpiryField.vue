<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '../i18n/index.ts';
import type { ExpiryValue } from '../window.ts';
import type { ViewZone } from '../preferences-core.ts';

const props = defineProps<{ idPrefix: string; modelValue: ExpiryValue; zone: ViewZone; hint?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: ExpiryValue] }>();
const { t } = useI18n();

const hintText = computed(() => props.hint ?? t('create.expiryHint'));

function patch(change: Partial<ExpiryValue>): void {
    emit('update:modelValue', { ...props.modelValue, ...change });
}
</script>

<template>
    <div class="field">
        <label class="field__label" :for="`${idPrefix}-expiry-mode`">{{ t('create.expiry') }}</label>
        <select
            :id="`${idPrefix}-expiry-mode`"
            class="select"
            :value="modelValue.mode"
            @change="patch({ mode: ($event.target as HTMLSelectElement).value as ExpiryValue['mode'] })"
        >
            <option value="never">{{ t('create.expiryNever') }}</option>
            <option value="date">{{ t('create.expiryDate') }}</option>
        </select>
        <input
            v-if="modelValue.mode === 'date'"
            :id="`${idPrefix}-expiry-date`"
            class="input"
            type="date"
            :aria-label="t('create.expiryDate')"
            :value="modelValue.date"
            @input="patch({ date: ($event.target as HTMLInputElement).value })"
        >
        <p class="field__hint">{{ hintText }}</p>
    </div>
</template>
