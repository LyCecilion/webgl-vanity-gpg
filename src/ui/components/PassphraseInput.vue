<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from '../i18n/index.ts';
import Icon from './Icon.vue';

const props = withDefaults(defineProps<{
    id: string;
    label: string;
    hint?: string;
    modelValue: string;
    autocomplete?: string;
    disabled?: boolean;
}>(), {
    hint: undefined,
    autocomplete: 'new-password',
    disabled: false,
});

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const { t } = useI18n();
const visible = ref(false);
const capsLock = ref(false);

function onInput(event: Event): void {
    emit('update:modelValue', (event.target as HTMLInputElement).value);
}

function checkCapsLock(event: KeyboardEvent): void {
    capsLock.value = event.getModifierState?.('CapsLock') ?? false;
}
</script>

<template>
    <div class="field">
        <label class="field__label" :for="id">{{ label }}</label>
        <div class="input-affix">
            <input
                :id="id"
                class="input"
                :type="visible ? 'text' : 'password'"
                :value="modelValue"
                :autocomplete="autocomplete"
                :disabled="disabled"
                spellcheck="false"
                @input="onInput"
                @keydown="checkCapsLock"
                @keyup="checkCapsLock"
                @blur="capsLock = false"
            >
            <button
                type="button"
                class="input-affix__button"
                :aria-label="visible ? t('common.hidePassword') : t('common.showPassword')"
                :title="visible ? t('common.hidePassword') : t('common.showPassword')"
                :disabled="disabled"
                @click="visible = !visible"
            >
                <Icon :name="visible ? 'eyeOff' : 'eye'" :size="16" />
            </button>
        </div>
        <p v-if="capsLock" class="field__hint text-warning">{{ t('common.capsLock') }}</p>
        <p v-if="hint" class="field__hint">{{ hint }}</p>
    </div>
</template>
