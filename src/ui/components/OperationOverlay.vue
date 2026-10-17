<script setup lang="ts">
import { computed, ref } from 'vue';
import { hitProbability } from '../difficulty.ts';
import { formatDuration, formatHashes, formatPercent, formatRate } from '../format.ts';
import { useI18n } from '../i18n/index.ts';
import { operation, stopOperation } from '../store.ts';
import BaseDialog from './BaseDialog.vue';

const { t } = useI18n();
const stopping = ref(false);

const title = computed(() => t(operation.titleKey));
const probability = computed(() => {
    if (operation.progress.expectedHashes === null) return 0;
    return hitProbability(operation.progress.expectedHashes, operation.progress.hashes);
});
const targetText = computed(() => {
    if (!operation.roleKey) return '';
    const role = t(operation.roleKey);
    if (operation.total > 1) return t('progress.target', { current: operation.current, total: operation.total, role });
    return role;
});
const expectedText = computed(() => operation.progress.expectedHashes === null
    ? ''
    : t('progress.expected', { hashes: formatHashes(operation.progress.expectedHashes) }));

function stop(): void {
    if (stopping.value) return;
    stopping.value = true;
    stopOperation();
}
</script>

<template>
    <BaseDialog
        :title="title"
        :closable="false"
        :close-label="t('common.close')"
    >
        <div v-if="!operation.waiting" class="progress">
            <div class="progress__head">
                <div>
                    <p class="progress__role">{{ targetText }}</p>
                    <p v-if="expectedText" class="progress__role">{{ expectedText }}</p>
                </div>
            </div>

            <div class="progress__stats">
                <div class="stat">
                    <div class="stat__label">{{ t('progress.hashes') }}</div>
                    <div class="stat__value" :title="String(operation.progress.hashes)">{{ formatHashes(operation.progress.hashes) }}</div>
                </div>
                <div class="stat">
                    <div class="stat__label">{{ t('progress.hashRate') }}</div>
                    <div class="stat__value">{{ formatRate(operation.progress.rate) }}</div>
                </div>
                <div class="stat">
                    <div class="stat__label">{{ t('progress.elapsed') }}</div>
                    <div class="stat__value">{{ formatDuration(operation.progress.elapsedMs) }}</div>
                </div>
                <div class="stat">
                    <div class="stat__label">{{ t('progress.materials') }}</div>
                    <div class="stat__value">{{ operation.progress.materials.toLocaleString() }}</div>
                </div>
            </div>

            <div class="meter">
                <div class="meter__head">
                    <span>{{ t('progress.probability') }}</span>
                    <span class="meter__value">{{ formatPercent(probability) }}</span>
                </div>
                <div class="meter__bar">
                    <div class="meter__fill" :style="{ width: `${probability * 100}%` }" />
                </div>
            </div>

            <div v-if="operation.windowText" class="progress__window">{{ operation.windowText }}</div>
            <p class="progress__note">{{ t('progress.note') }}</p>
        </div>

        <div v-else class="progress">
            <div class="progress__wait">
                <span class="spinner" aria-hidden="true" />
                <span>{{ t('progress.wait') }}</span>
            </div>
        </div>

        <template v-if="operation.cancellable" #footer>
            <button type="button" class="btn btn--danger" :disabled="stopping" @click="stop">
                {{ stopping ? t('progress.stopping') : t('progress.stop') }}
            </button>
        </template>
    </BaseDialog>
</template>
