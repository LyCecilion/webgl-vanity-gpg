<script setup lang="ts">
import { computed } from 'vue';
import { formatDateTime, fingerprintGroups, keyId } from '../format.ts';
import { useI18n } from '../i18n/index.ts';
import { preferences } from '../preferences.ts';
import { certificate, ui } from '../store.ts';
import type { CertificateRow } from '../store.ts';
import BaseDialog from './BaseDialog.vue';
import CopyButton from './CopyButton.vue';
import RoleBadges from './RoleBadges.vue';

const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();

const row = computed<CertificateRow | undefined>(() => {
    if (ui.detailFingerprint) return certificate.rows.find(item => item.fingerprint === ui.detailFingerprint);
    return certificate.rows[0];
});

const secretText = computed(() => {
    switch (row.value?.secret) {
        case 'protected': return t('cert.secretProtected');
        case 'unprotected': return t('cert.secretUnprotected');
        case 'dummy': return t('cert.secretDummy');
        default: return t('cert.secretUnknown');
    }
});

const expiryText = computed(() => {
    const item = row.value;
    if (!item) return '—';
    if (!item.expirationKnown) return t('cert.invalid');
    if (item.expirationMs === null) return t('cert.expiryNever');
    const local = formatDateTime(item.expirationMs, preferences.viewZone);
    const utc = `${formatDateTime(item.expirationMs, 'utc')} UTC`;
    return `${local} / ${utc}`;
});
</script>

<template>
    <BaseDialog :title="t('cert.details')" :close-label="t('common.close')" @close="emit('close')">
        <template v-if="row">
            <dl class="detail-grid">
                <dt>{{ t('cert.usage') }}</dt>
                <dd><RoleBadges :usage="row.usage" /></dd>

                <dt>{{ t('cert.fingerprint') }}</dt>
                <dd>
                    <span class="key-card__title">
                        <code>{{ fingerprintGroups(row.fingerprint) }}</code>
                        <CopyButton :value="row.fingerprint" :label="t('cert.copyFingerprint')" />
                    </span>
                </dd>

                <dt>{{ t('cert.keyId') }}</dt>
                <dd><code>{{ keyId(row.fingerprint) }}</code></dd>

                <dt>{{ t('cert.algorithm') }}</dt>
                <dd>{{ row.algorithm }}</dd>

                <dt>{{ t('cert.createdLocal', { zone: preferences.viewZone === 'utc' ? 'UTC' : t('common.local') }) }}</dt>
                <dd><code>{{ formatDateTime(row.createdMs, preferences.viewZone) }}</code></dd>

                <dt>{{ t('cert.createdUtc') }}</dt>
                <dd><code>{{ formatDateTime(row.createdMs, 'utc') }} UTC</code></dd>

                <dt>{{ t('cert.expires') }}</dt>
                <dd>{{ expiryText }}</dd>

                <dt>{{ t('cert.secret') }}</dt>
                <dd>{{ secretText }}</dd>

                <dt>{{ t('cert.keyFlags') }}</dt>
                <dd>{{ row.usage.join(' / ') || t('common.unknown') }}</dd>

                <dt>{{ t('cert.revoked') }}</dt>
                <dd>{{ row.revoked ? t('cert.revoked') : t('common.none') }}</dd>
            </dl>

            <template v-if="row.primary && certificate.userIDs.length > 0">
                <h3 class="card__title" style="margin-top: var(--space-4)">{{ t('import.previewUids') }}</h3>
                <ul class="scope__items">
                    <li v-for="uid in certificate.userIDs" :key="uid">{{ uid }}</li>
                </ul>
            </template>
        </template>
        <p v-else class="muted">{{ t('dash.blocked.noDocument') }}</p>

        <template #footer>
            <button type="button" class="btn btn--secondary" @click="emit('close')">{{ t('common.close') }}</button>
        </template>
    </BaseDialog>
</template>
