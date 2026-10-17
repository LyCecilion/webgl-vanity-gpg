<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '../i18n/index.ts';
import { clearCertificate, confirmBackupSaved } from '../operations.ts';
import {
    addBlocked,
    askConfirmation,
    certificate,
    hasDocument,
    openDialog,
    openExportDialog,
    openRenewDialog,
    renewBlocked,
    renewReason,
    ui,
} from '../store.ts';
import Icon from './Icon.vue';
import KeyTree from './KeyTree.vue';

const { t } = useI18n();

const canAdd = computed(() => hasDocument.value && addBlocked.value.length === 0);
const renewCandidates = computed(() => certificate.rows.filter(row => renewReason(row) === null));
const canRenew = computed(() => renewBlocked.value.length === 0 && renewCandidates.value.length > 0);
const hasSubkeys = computed(() => certificate.rows.length > 1);

function openAdd(): void {
    if (!canAdd.value) return;
    openDialog('add');
}

function openRenew(fingerprint?: string): void {
    if (!canRenew.value) return;
    openRenewDialog(fingerprint ? [fingerprint] : []);
}

function openDetails(fingerprint: string): void {
    ui.detailFingerprint = fingerprint;
    openDialog('details');
}

function openDevice(fingerprint: string): void {
    openExportDialog('device', [fingerprint]);
}

async function clearCurrent(): Promise<void> {
    const confirmed = await askConfirmation({
        title: t('dash.clear.title'),
        message: t('dash.clear.desc'),
        confirmLabel: t('dash.clear.confirm'),
        cancelLabel: t('common.cancel'),
        danger: true,
    });
    if (confirmed) clearCertificate();
}
</script>

<template>
    <section class="dashboard">
        <header class="dashboard__header">
            <div class="dashboard__heading">
                <h1 class="dashboard__title">{{ t('dash.title') }}</h1>
                <p class="dashboard__subtitle">{{ t('dash.subtitle') }}</p>
            </div>
            <div class="dashboard__actions">
                <button type="button" class="btn btn--primary" :disabled="!canAdd" @click="openAdd">
                    <Icon name="plus" :size="16" />
                    {{ t('dash.actions.add') }}
                </button>
                <button type="button" class="btn btn--secondary" :disabled="!canRenew" @click="openRenew()">
                    {{ t('dash.actions.renew') }}
                </button>
                <button type="button" class="btn btn--secondary" @click="openExportDialog('public')">
                    {{ t('dash.actions.export') }}
                </button>
                <button type="button" class="btn btn--ghost" @click="openDialog('import')">
                    {{ t('dash.actions.import') }}
                </button>
            </div>
        </header>

        <p v-if="addBlocked.length > 0" class="dashboard__blocked">
            {{ addBlocked.map(key => t(key)).join(' ') }}
        </p>
        <p v-else-if="renewBlocked.length > 0" class="dashboard__blocked">
            {{ renewBlocked.map(key => t(key)).join(' ') }}
        </p>

        <div v-if="certificate.dirtyBackup" class="banner banner--warning">
            <div class="banner__body">
                <p class="banner__title">
                    {{ certificate.backupStarted ? t('dash.backup.startedTitle') : t('dash.backup.dirtyTitle') }}
                </p>
                <p class="banner__desc">
                    {{ certificate.backupStarted ? t('dash.backup.startedDesc') : t('dash.backup.dirtyDesc') }}
                </p>
                <div class="banner__actions">
                    <button
                        v-if="!certificate.backupStarted"
                        type="button"
                        class="btn btn--primary btn--sm"
                        @click="openExportDialog('backup')"
                    >
                        <Icon name="download" :size="14" />
                        {{ t('dash.backup.download') }}
                    </button>
                    <button
                        v-else
                        type="button"
                        class="btn btn--primary btn--sm"
                        @click="confirmBackupSaved()"
                    >
                        <Icon name="check" :size="14" />
                        {{ t('dash.backup.confirm') }}
                    </button>
                </div>
            </div>
        </div>

        <KeyTree
            :rows="certificate.rows"
            :uids="certificate.userIDs"
            @details="openDetails"
            @renew="openRenew"
            @device="openDevice"
        />

        <p v-if="!hasSubkeys" class="key-tree__empty">{{ t('dash.noSubkeys') }}</p>

        <div class="dashboard__footer-actions">
            <button type="button" class="btn btn--ghost btn--sm" @click="clearCurrent">
                <Icon name="trash" :size="14" />
                {{ t('dash.actions.clear') }}
            </button>
        </div>
    </section>
</template>
