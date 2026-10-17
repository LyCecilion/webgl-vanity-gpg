<script setup lang="ts">
import { dismissToast, toasts } from '../store.ts';
import Icon from './Icon.vue';
</script>

<template>
    <div class="toast-host" aria-live="polite" aria-atomic="false">
        <div
            v-for="toast in toasts"
            :key="toast.id"
            class="toast"
            :class="`toast--${toast.kind}`"
            :role="toast.kind === 'error' ? 'alert' : 'status'"
        >
            <div class="toast__body">
                <div>{{ toast.message }}</div>
                <div v-if="toast.detail" class="toast__detail">{{ toast.detail }}</div>
            </div>
            <button type="button" class="toast__close" aria-label="Close" @click="dismissToast(toast.id)">
                <Icon name="close" :size="14" />
            </button>
        </div>
    </div>
</template>
