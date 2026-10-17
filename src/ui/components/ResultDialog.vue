<script setup lang="ts">
import { computed } from 'vue';
import { formatDuration, fingerprintGroups } from '../format.ts';
import { useI18n } from '../i18n/index.ts';
import { closeDialog, lastRun, openDialog, openExportDialog } from '../store.ts';
import BaseDialog from './BaseDialog.vue';
import CopyButton from './CopyButton.vue';
import Icon from './Icon.vue';

const { t } = useI18n();

const description = computed(() => lastRun.kind === 'add' ? t('add.success.desc') : t('create.success.desc'));
const title = computed(() => lastRun.kind === 'add' ? t('add.success.title') : t('create.success.title'));

function backup(): void {
    closeDialog();
    openExportDialog('backup');
}

function addMore(): void {
    closeDialog();
    openDialog('add');
}
</script>

<template>
    <BaseDialog :title="t('result.title')" :close-label="t('common.close')" @close="closeDialog">
        <div class="result">
            <div class="result__hero">
                <span class="result__icon"><Icon name="check" :size="22" /></span>
                <div>
                    <h3 class="card__title">{{ title }}</h3>
                    <p class="muted" style="font-size: var(--text-sm)">{{ description }}</p>
                </div>
            </div>

            <div class="preview">
                <span class="field__label">{{ t('cert.fingerprint') }}</span>
                <div class="key-card__title">
                    <code class="result__fingerprint">{{ fingerprintGroups(lastRun.fingerprint) }}</code>
                    <CopyButton :value="lastRun.fingerprint" :label="t('cert.copyFingerprint')" />
                </div>
                <div v-if="lastRun.fingerprints.length > 0" class="key-card__tags">
                    <span v-for="fingerprint in lastRun.fingerprints" :key="fingerprint" class="badge badge--mono" :title="fingerprint">
                        {{ fingerprint.slice(0, 8) }}…{{ fingerprint.slice(-8) }}
                    </span>
                </div>
            </div>

            <div class="progress__stats">
                <div class="stat">
                    <div class="stat__label">{{ t('progress.hashes') }}</div>
                    <div class="stat__value">{{ lastRun.hashes.toLocaleString() }}</div>
                </div>
                <div class="stat">
                    <div class="stat__label">{{ t('progress.elapsed') }}</div>
                    <div class="stat__value">{{ formatDuration(lastRun.elapsedMs) }}</div>
                </div>
                <div class="stat">
                    <div class="stat__label">{{ t('progress.materials') }}</div>
                    <div class="stat__value">{{ lastRun.materials.toLocaleString() }}</div>
                </div>
                <div class="stat">
                    <div class="stat__label">{{ t('progress.hashRate') }}</div>
                    <div class="stat__value">{{ lastRun.rate ? `${(lastRun.rate / 1e6).toFixed(1)} M/s` : '—' }}</div>
                </div>
            </div>

            <div class="banner banner--warning"><p class="banner__desc">{{ t('result.backupHint') }}</p></div>
        </div>

        <template #footer>
            <button type="button" class="btn btn--ghost" @click="closeDialog">{{ t('common.done') }}</button>
            <button type="button" class="btn btn--secondary" @click="addMore">{{ t('result.continueAdd') }}</button>
            <button type="button" class="btn btn--primary" data-submit="true" @click="backup">
                <Icon name="download" :size="15" />
                {{ t('create.success.backup') }}
            </button>
        </template>
    </BaseDialog>
</template>
