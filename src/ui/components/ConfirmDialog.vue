<script setup lang="ts">
import { confirmation, resolveConfirmation } from '../store.ts';
import { useI18n } from '../i18n/index.ts';
import BaseDialog from './BaseDialog.vue';

const { t } = useI18n();
</script>

<template>
    <BaseDialog
        v-if="confirmation.open"
        :title="confirmation.title"
        size="narrow"
        :close-label="t('common.close')"
        @close="resolveConfirmation(false)"
    >
        <p class="confirm__message">{{ confirmation.message }}</p>
        <template #footer>
            <button type="button" class="btn btn--secondary" @click="resolveConfirmation(false)">
                {{ confirmation.cancelLabel }}
            </button>
            <button
                type="button"
                class="btn"
                :class="confirmation.danger ? 'btn--danger' : 'btn--primary'"
                @click="resolveConfirmation(true)"
            >
                {{ confirmation.confirmLabel }}
            </button>
        </template>
    </BaseDialog>
</template>
