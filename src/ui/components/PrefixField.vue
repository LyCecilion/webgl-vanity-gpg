<script setup lang="ts">
import { computed } from 'vue';
import { difficultyCategory, difficultyCategoryKeys, estimateSeconds, expectedHashes } from '../difficulty.ts';
import { formatDuration, formatHashes } from '../format.ts';
import { useI18n } from '../i18n/index.ts';
import { preferences } from '../preferences.ts';

const props = withDefaults(defineProps<{ id: string; modelValue: string; label?: string; hint?: string; maxlength?: number }>(), {
    label: undefined,
    hint: undefined,
    maxlength: 40,
});
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const { t } = useI18n();

const cleaned = computed(() => props.modelValue.replace(/\s+/g, '').toUpperCase());
const valid = computed(() => /^[0-9A-F]{1,40}$/.test(cleaned.value));
const expected = computed(() => valid.value ? expectedHashes(cleaned.value.length) : null);
const category = computed(() => expected.value === null ? null : difficultyCategory(expected.value, preferences.measuredRate));
const seconds = computed(() => expected.value === null ? null : estimateSeconds(expected.value, preferences.measuredRate));
const width = computed(() => ({ instant: 10, seconds: 28, minutes: 50, hours: 70, days: 88, infeasible: 100 }[category.value ?? 'instant']));
const note = computed(() => category.value ? t(difficultyCategoryKeys[category.value]) : '');
const timeText = computed(() => seconds.value === null
    ? t('difficulty.unknownRate')
    : t('difficulty.time', { time: formatDuration(seconds.value * 1000) }));
const warning = computed(() => category.value === 'days' || category.value === 'infeasible');

function onInput(event: Event): void {
    emit('update:modelValue', (event.target as HTMLInputElement).value);
}
</script>

<template>
    <div class="field">
        <label class="field__label" :for="id">{{ label ?? t('create.prefix') }}</label>
        <input
            :id="id"
            class="input mono uppercase"
            :value="modelValue"
            :maxlength="maxlength"
            spellcheck="false"
            autocomplete="off"
            autocapitalize="characters"
            @input="onInput"
        >
        <p class="field__hint">{{ hint ?? t('create.prefixHint') }}</p>
        <div v-if="expected !== null && category !== null" class="difficulty" :class="`difficulty--${category}`">
            <div class="difficulty__row">
                <span>{{ t('difficulty.label') }}</span>
                <span class="difficulty__value">{{ t('difficulty.expected', { hashes: formatHashes(expected) }) }}</span>
            </div>
            <div class="difficulty__bar">
                <div class="difficulty__fill" :style="{ width: `${width}%` }" />
            </div>
            <div class="difficulty__row">
                <span>{{ note }}</span>
                <span>{{ timeText }}</span>
            </div>
            <p v-if="warning" class="difficulty__warning">{{ t('difficulty.warning') }}</p>
            <p class="difficulty__note">{{ t('difficulty.note') }}</p>
        </div>
    </div>
</template>
