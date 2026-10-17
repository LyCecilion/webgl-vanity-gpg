<script setup lang="ts">
import { computed } from 'vue';
import { copyText } from '../browser.ts';
import { shortFingerprint } from '../format.ts';
import { useI18n } from '../i18n/index.ts';
import { backupNeedsAttention, certificate, hasDocument, openDialog, openExportDialog, pushToast } from '../store.ts';
import { resolvedTheme, toggleTheme } from '../theme.ts';
import Icon from './Icon.vue';

const { t } = useI18n();

const short = computed(() => shortFingerprint(certificate.fingerprint));
const hasPrimarySecret = computed(() => certificate.rows[0]?.hasSecret ?? false);
const isDark = computed(() => resolvedTheme.value === 'mocha');

async function copyFingerprint(): Promise<void> {
    if (!certificate.fingerprint) return;
    if (await copyText(certificate.fingerprint)) pushToast('success', t('toast.copied'));
    else pushToast('error', t('error.clipboard'));
}

function scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
</script>

<template>
    <header class="topbar">
        <div class="topbar__inner">
            <button type="button" class="brand" @click="scrollToTop">
                <span class="brand__mark" aria-hidden="true">◆</span>
                <span class="brand__name">{{ t('app.name') }}</span>
            </button>
            <div class="topbar__badges">
                <span class="badge badge--local">{{ t('app.localOnly') }}</span>
                <template v-if="hasDocument">
                    <button type="button" class="cert-chip" :title="t('cert.copyFingerprint')" @click="copyFingerprint">
                        <span class="cert-chip__label">{{ t('topbar.certificate') }}</span>
                        <code>{{ short }}</code>
                        <Icon name="copy" :size="13" />
                    </button>
                    <button
                        v-if="backupNeedsAttention"
                        type="button"
                        class="badge badge--warning"
                        :title="t('dash.backup.dirtyTitle')"
                        @click="openExportDialog('backup')"
                    >
                        <Icon name="alert" :size="12" />
                        {{ t('topbar.backupNeeded') }}
                    </button>
                    <span v-else-if="!hasPrimarySecret" class="badge badge--info">
                        <Icon name="key" :size="12" />
                        {{ t('topbar.deviceKey') }}
                    </span>
                    <span v-else class="badge badge--success">
                        <Icon name="check" :size="12" />
                        {{ t('topbar.backupSaved') }}
                    </span>
                </template>
            </div>
            <div class="topbar__actions">
                <button type="button" class="icon-btn" :aria-label="t('theme.toggle')" :title="t('theme.toggle')" @click="toggleTheme">
                    <Icon :name="isDark ? 'sun' : 'moon'" :size="18" />
                </button>
                <button type="button" class="icon-btn" :aria-label="t('topbar.help')" :title="t('topbar.help')" @click="openDialog('help')">
                    <Icon name="help" :size="18" />
                </button>
                <button type="button" class="icon-btn" :aria-label="t('topbar.settings')" :title="t('topbar.settings')" @click="openDialog('settings')">
                    <Icon name="settings" :size="18" />
                </button>
            </div>
        </div>
    </header>
</template>
