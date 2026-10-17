<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import Icon from './Icon.vue';

const props = withDefaults(defineProps<{
    title: string;
    subtitle?: string;
    size?: 'normal' | 'wide' | 'narrow';
    closable?: boolean;
    busy?: boolean;
    closeLabel?: string;
}>(), {
    subtitle: undefined,
    size: 'normal',
    closable: true,
    busy: false,
    closeLabel: 'Close',
});

const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
const titleId = `dialog-title-${Math.random().toString(36).slice(2, 9)}`;
let scrollLocked = false;

onMounted(() => {
    scrollLocked = document.body.classList.contains('dialog-open');
    document.body.classList.add('dialog-open');
    if (dialog.value && !dialog.value.open) dialog.value.showModal();
});

onBeforeUnmount(() => {
    if (dialog.value?.open) dialog.value.close();
    if (!scrollLocked) document.body.classList.remove('dialog-open');
});

function requestClose(): void {
    if (!props.closable || props.busy) return;
    emit('close');
}

function onCancel(event: Event): void {
    event.preventDefault();
    requestClose();
}

function onBackdropClick(event: MouseEvent): void {
    if (event.target === dialog.value) requestClose();
}
</script>

<template>
    <dialog
        ref="dialog"
        class="dialog"
        :class="{ 'dialog--wide': size === 'wide', 'dialog--narrow': size === 'narrow' }"
        :aria-labelledby="titleId"
        @cancel="onCancel"
        @click="onBackdropClick"
    >
        <div class="dialog__panel">
            <header class="dialog__header">
                <div class="dialog__heading">
                    <h2 :id="titleId" class="dialog__title">{{ title }}</h2>
                    <p v-if="subtitle" class="dialog__subtitle">{{ subtitle }}</p>
                    <slot name="header-extra" />
                </div>
                <button
                    v-if="closable"
                    type="button"
                    class="dialog__close"
                    :aria-label="closeLabel"
                    :disabled="busy"
                    @click="requestClose"
                >
                    <Icon name="close" :size="18" />
                </button>
            </header>
            <div class="dialog__body">
                <slot />
            </div>
            <footer v-if="$slots.footer" class="dialog__footer">
                <slot name="footer" />
            </footer>
        </div>
    </dialog>
</template>
