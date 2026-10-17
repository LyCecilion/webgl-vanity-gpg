<script setup lang="ts">
import { ref } from 'vue';
import { copyText } from '../browser.ts';
import Icon from './Icon.vue';

const props = withDefaults(defineProps<{ value: string; label?: string; copiedLabel?: string; size?: number }>(), {
    label: 'Copy',
    copiedLabel: 'Copied',
    size: 15,
});

const copied = ref(false);
let timer: number | undefined;

async function copy(): Promise<void> {
    const ok = await copyText(props.value);
    if (!ok) return;
    copied.value = true;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { copied.value = false; }, 1600);
}
</script>

<template>
    <button
        type="button"
        class="copy-btn"
        :class="{ 'copy-btn--copied': copied }"
        :aria-label="copied ? copiedLabel : label"
        :title="copied ? copiedLabel : label"
        @click.stop="copy"
    >
        <Icon :name="copied ? 'check' : 'copy'" :size="size" />
    </button>
</template>
