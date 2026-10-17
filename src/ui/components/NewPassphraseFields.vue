<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '../i18n/index.ts';
import type { MessageKey } from '../i18n/messages.ts';
import PassphraseInput from './PassphraseInput.vue';

const props = withDefaults(defineProps<{
    idPrefix: string;
    passphrase: string;
    confirmation: string;
    allowUnprotected: boolean;
    showAllow?: boolean;
    passphraseLabel?: string;
    confirmationLabel?: string;
    allowLabel?: string;
    hint?: string;
}>(), {
    showAllow: true,
    passphraseLabel: undefined,
    confirmationLabel: undefined,
    allowLabel: undefined,
    hint: undefined,
});

const emit = defineEmits<{
    'update:passphrase': [value: string];
    'update:confirmation': [value: string];
    'update:allowUnprotected': [value: boolean];
}>();
const { t } = useI18n();

const mismatch = computed(() => props.confirmation.length > 0 && props.confirmation !== props.passphrase);

const strength = computed(() => {
    const value = props.passphrase;
    if (value.length === 0) return null;
    let score = 0;
    if (value.length >= 8) score++;
    if (value.length >= 12) score++;
    if (value.length >= 16) score++;
    if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
    if (/\d/.test(value)) score++;
    if (/[^A-Za-z0-9]/.test(value)) score++;
    const level = Math.min(4, Math.max(1, Math.ceil((score / 6) * 4)));
    const keys: readonly MessageKey[] = ['passphrase.strength.weak', 'passphrase.strength.fair', 'passphrase.strength.good', 'passphrase.strength.strong'];
    return { level, label: t(keys[level - 1]) };
});

const passphraseLabel = computed(() => props.passphraseLabel ?? t('create.passphrase'));
const confirmationLabel = computed(() => props.confirmationLabel ?? t('create.passphraseConfirm'));
const allowLabel = computed(() => props.allowLabel ?? t('create.allowUnprotected'));
</script>

<template>
    <div>
        <PassphraseInput
            :id="`${idPrefix}-passphrase`"
            :label="passphraseLabel"
            :hint="hint"
            :model-value="passphrase"
            @update:model-value="emit('update:passphrase', $event)"
        />
        <div v-if="strength" class="passphrase-strength">
            <div class="passphrase-strength__head">
                <span>{{ t('passphrase.strengthLabel') }}</span>
                <span class="difficulty__value">{{ strength.label }}</span>
            </div>
            <div class="passphrase-strength__bar">
                <div class="passphrase-strength__fill" :class="`passphrase-strength__fill--${strength.level}`" :style="{ width: `${strength.level * 25}%` }" />
            </div>
        </div>

        <PassphraseInput
            :id="`${idPrefix}-passphrase-confirm`"
            :label="confirmationLabel"
            :model-value="confirmation"
            @update:model-value="emit('update:confirmation', $event)"
        />
        <p v-if="mismatch" class="field__error">{{ t('error.passphraseMismatch') }}</p>

        <div v-if="showAllow" class="field" style="margin-top: var(--space-2)">
            <label class="checkbox">
                <input
                    type="checkbox"
                    :checked="allowUnprotected"
                    @change="emit('update:allowUnprotected', ($event.target as HTMLInputElement).checked)"
                >
                <span>{{ allowLabel }}</span>
            </label>
            <p v-if="allowUnprotected" class="field__hint text-warning">{{ t('create.unprotectedWarning') }}</p>
        </div>
    </div>
</template>
