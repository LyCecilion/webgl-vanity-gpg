<script setup lang="ts">
import { computed } from 'vue';
import { formatDateTime, shortFingerprint } from '../format.ts';
import { useI18n } from '../i18n/index.ts';
import { deviceEligibility, renewReason } from '../store.ts';
import type { CertificateRow } from '../store.ts';
import { preferences } from '../preferences.ts';
import CopyButton from './CopyButton.vue';
import Icon from './Icon.vue';
import RoleBadges from './RoleBadges.vue';

const props = defineProps<{ row: CertificateRow; uids: string[] }>();
const emit = defineEmits<{ details: [fingerprint: string]; renew: [fingerprint: string]; device: [fingerprint: string] }>();
const { t } = useI18n();

const created = computed(() => formatDateTime(props.row.createdMs, preferences.viewZone));
const createdUtc = computed(() => `${formatDateTime(props.row.createdMs, 'utc')} UTC`);
const expiry = computed(() => {
    if (!props.row.expirationKnown) return t('cert.invalid');
    if (props.row.expirationMs === null) return t('cert.expiryNever');
    const moment = formatDateTime(props.row.expirationMs, preferences.viewZone);
    return props.row.expired ? `${moment} · ${t('cert.expired')}` : moment;
});
const expiryUtc = computed(() => {
    if (!props.row.expirationKnown || props.row.expirationMs === null) return undefined;
    return `${formatDateTime(props.row.expirationMs, 'utc')} UTC`;
});
const secretLabel = computed(() => {
    switch (props.row.secret) {
        case 'protected': return t('cert.secretProtected');
        case 'unprotected': return t('cert.secretUnprotected');
        case 'dummy': return t('cert.secretDummy');
        default: return t('cert.secretUnknown');
    }
});
const canRenew = computed(() => renewReason(props.row) === null);
const canExportForDevice = computed(() => !props.row.primary && deviceEligibility(props.row) === null);
</script>

<template>
    <article class="key-card" :class="{ 'key-card--primary': row.primary }">
        <div class="key-card__main">
            <div class="key-card__body">
                <div class="key-card__title">
                    <RoleBadges :usage="row.usage" />
                    <code class="fingerprint">{{ shortFingerprint(row.fingerprint) }}</code>
                    <CopyButton :value="row.fingerprint" :label="t('cert.copyFingerprint')" />
                    <span class="badge badge--mono">{{ row.algorithm }}</span>
                </div>
                <div v-if="row.primary && uids.length > 0" class="key-card__uids">
                    {{ uids.join(' · ') }}
                </div>
                <div class="key-card__meta">
                    <span class="key-card__meta-item" :title="createdUtc">
                        <Icon name="clock" :size="13" />
                        {{ created }}
                    </span>
                    <span
                        class="key-card__meta-item"
                        :class="{ 'key-card__meta-item--danger': row.expired }"
                        :title="expiryUtc"
                    >
                        <Icon name="calendar" :size="13" />
                        {{ expiry }}
                    </span>
                    <span class="key-card__meta-item">
                        <Icon :name="row.secret === 'dummy' ? 'unlock' : 'lock'" :size="13" />
                        {{ secretLabel }}
                    </span>
                </div>
                <div class="key-card__tags">
                    <span class="badge" :class="row.primary ? 'badge--accent' : ''">
                        {{ row.primary ? t('cert.primary') : t('cert.subkey') }}
                    </span>
                    <span v-if="row.revoked" class="badge badge--danger">{{ t('cert.revoked') }}</span>
                    <span v-if="!row.expirationKnown" class="badge badge--warning">{{ t('cert.noSelfCert') }}</span>
                    <span v-if="!row.hasSecret" class="badge">{{ t('cert.secretDummy') }}</span>
                </div>
            </div>
            <div class="key-card__actions">
                <button type="button" class="btn btn--ghost btn--sm" @click="emit('details', row.fingerprint)">
                    {{ t('dash.actions.detail') }}
                </button>
                <button
                    v-if="canRenew"
                    type="button"
                    class="btn btn--secondary btn--sm"
                    :aria-label="t('dash.actions.renew')"
                    @click="emit('renew', row.fingerprint)"
                >
                    {{ t('dash.actions.renew') }}
                </button>
                <button
                    v-if="canExportForDevice"
                    type="button"
                    class="btn btn--secondary btn--sm"
                    @click="emit('device', row.fingerprint)"
                >
                    {{ t('export.tab.device') }}
                </button>
            </div>
        </div>
    </article>
</template>
