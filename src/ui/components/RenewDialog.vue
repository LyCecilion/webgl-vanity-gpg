<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { friendlyError, uiError } from '../errors.ts';
import { formatDateInput, formatDateTime, shortFingerprint } from '../format.ts';
import { useI18n } from '../i18n/index.ts';
import { renewKeys } from '../operations.ts';
import { preferences } from '../preferences.ts';
import { certificate, closeDialog, renewReason, ui } from '../store.ts';
import type { CertificateRow } from '../store.ts';
import { resolveExpiration } from '../../time-window.ts';
import BaseDialog from './BaseDialog.vue';
import PassphraseInput from './PassphraseInput.vue';
import RoleBadges from './RoleBadges.vue';

defineEmits<{ close: [] }>();
const { t, locale } = useI18n();

const eligible = computed(() => certificate.rows.filter(row => renewReason(row) === null));
const selection = reactive<Record<string, boolean>>({});
for (const row of eligible.value) {
    selection[row.fingerprint] = ui.renewPreselect.length === 0 || ui.renewPreselect.includes(row.fingerprint);
}

const mode = ref<'1y' | '2y' | '3y' | 'never' | 'custom'>('1y');
const zone = ref(preferences.viewZone);
const customDate = ref(formatDateInput(Date.now() + 365 * 86_400_000, preferences.viewZone));
const primaryPassphrase = ref('');
const subkeyPassphrases = reactive<Record<string, string>>({});
const error = ref('');
const errorDetail = ref('');

const selected = computed(() => certificate.rows.filter(row => selection[row.fingerprint] === true && renewReason(row) === null));
const primaryProtected = computed(() => certificate.rows[0]?.secret === 'protected');

const expiresAt = computed<Date | null>(() => {
    if (mode.value === 'never') return null;
    if (mode.value === 'custom') {
        return customDate.value ? resolveExpiration(customDate.value, zone.value) : null;
    }
    const days = mode.value === '1y' ? 365 : mode.value === '2y' ? 730 : 1095;
    return resolveExpiration(formatDateInput(Date.now() + days * 86_400_000, zone.value), zone.value);
});

const expiresAtText = computed(() => {
    try {
        const value = expiresAt.value;
        return value ? formatDateTime(value.getTime(), zone.value) : t('create.expiryNever');
    } catch {
        return '—';
    }
});

const signingSelected = computed(() => selected.value.filter(row => row.role === 'signing'));

function expiryText(row: CertificateRow): string {
    if (!row.expirationKnown) return t('cert.invalid');
    if (row.expirationMs === null) return t('cert.expiryNever');
    return formatDateTime(row.expirationMs, preferences.viewZone);
}

function selectAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    for (const row of eligible.value) selection[row.fingerprint] = checked;
}

function validate(): boolean {
    error.value = '';
    errorDetail.value = '';
    try {
        if (selected.value.length === 0) throw uiError('error.selectionRequired');
        if (primaryProtected.value && !primaryPassphrase.value) throw uiError('error.passphraseRequired');
        const value = expiresAt.value;
        if (mode.value !== 'never' && !value) throw uiError('error.invalidDate');
        if (value && value.getTime() <= Date.now()) throw uiError('error.expiryPast');
        if (value) {
            const shortened = selected.value.filter(row => row.expirationMs !== null && value.getTime() <= row.expirationMs);
            if (shortened.length > 0) throw uiError('error.expiryShorten');
        }
        return true;
    } catch (caught) {
        const friendly = friendlyError(caught, locale.value);
        error.value = friendly.message;
        errorDetail.value = friendly.detail ?? '';
        return false;
    }
}

function apply(): void {
    if (!validate()) return;
    const fingerprints = selected.value.map(row => row.fingerprint);
    const passphrases: Record<string, string> = {};
    for (const row of signingSelected.value) {
        const passphrase = subkeyPassphrases[row.fingerprint];
        if (passphrase) passphrases[row.fingerprint] = passphrase;
    }
    closeDialog();
    void renewKeys({
        fingerprints,
        expiresAt: expiresAt.value,
        primaryPassphrase: primaryPassphrase.value,
        subkeyPassphrases: passphrases,
    });
}
</script>

<template>
    <BaseDialog :title="t('renew.title')" :subtitle="t('renew.subtitle')" size="wide" :close-label="t('common.close')" @close="$emit('close')">
        <div v-if="error" class="banner banner--danger" role="alert">
            <div class="banner__body">
                <p class="banner__title">{{ error }}</p>
                <p v-if="errorDetail" class="banner__desc">{{ errorDetail }}</p>
            </div>
        </div>

        <template v-if="eligible.length === 0">
            <p class="muted">{{ t('renew.noEligible') }}</p>
        </template>

        <template v-else>
            <div class="inline-row" style="justify-content: space-between">
                <span class="field__label">{{ t('renew.select') }}</span>
                <label class="checkbox">
                    <input type="checkbox" :checked="selected.length === eligible.length" @change="selectAll">
                    <span>{{ t('renew.selectedCount', { count: selected.length }) }}</span>
                </label>
            </div>
            <p class="field__hint">{{ t('renew.selectHint') }}</p>

            <ul class="selection-list" style="margin-top: var(--space-2)">
                <li v-for="row in certificate.rows" :key="row.fingerprint" class="selection-item" :class="{ 'selection-item--disabled': renewReason(row) !== null }">
                    <input
                        :id="`renew-${row.fingerprint}`"
                        v-model="selection[row.fingerprint]"
                        type="checkbox"
                        :disabled="renewReason(row) !== null"
                        style="margin-top: 0.3rem"
                    >
                    <div class="selection-item__body">
                        <label :for="`renew-${row.fingerprint}`" class="selection-item__title">
                            <RoleBadges :usage="row.usage" />
                            <code>{{ shortFingerprint(row.fingerprint) }}</code>
                            <span class="muted">{{ expiryText(row) }}</span>
                        </label>
                        <p v-if="renewReason(row)" class="field__hint">{{ t(renewReason(row)!) }}</p>
                        <PassphraseInput
                            v-if="selection[row.fingerprint] && row.role === 'signing'"
                            :id="`renew-passphrase-${row.fingerprint}`"
                            v-model="subkeyPassphrases[row.fingerprint]"
                            :label="t('renew.subkeyPassphrase')"
                            :hint="t('renew.subkeyPassphraseHint')"
                            autocomplete="current-password"
                        />
                    </div>
                </li>
            </ul>

            <div class="grid-2" style="margin-top: var(--space-4)">
                <div class="field">
                    <label class="field__label" for="renew-mode">{{ t('renew.newExpiry') }}</label>
                    <select id="renew-mode" v-model="mode" class="select">
                        <option value="1y">{{ t('renew.preset.1y') }}</option>
                        <option value="2y">{{ t('renew.preset.2y') }}</option>
                        <option value="3y">{{ t('renew.preset.3y') }}</option>
                        <option value="never">{{ t('renew.preset.never') }}</option>
                        <option value="custom">{{ t('renew.preset.custom') }}</option>
                    </select>
                </div>
                <div class="field">
                    <label class="field__label" for="renew-zone">{{ t('create.window.zone') }}</label>
                    <select id="renew-zone" v-model="zone" class="select">
                        <option value="local">{{ t('common.local') }}</option>
                        <option value="utc">UTC</option>
                    </select>
                </div>
            </div>
            <div v-if="mode === 'custom'" class="field">
                <label class="field__label" for="renew-date">{{ t('renew.date') }}</label>
                <input id="renew-date" v-model="customDate" class="input" type="date">
            </div>
            <p class="field__hint">
                {{ t('create.review.expiry') }}: {{ expiresAtText }}
            </p>

            <PassphraseInput
                id="renew-primary-passphrase"
                v-model="primaryPassphrase"
                :label="t('renew.primaryPassphrase')"
                :hint="t('renew.primaryPassphraseHint')"
                autocomplete="current-password"
            />
        </template>

        <template #footer>
            <button type="button" class="btn btn--secondary" @click="$emit('close')">{{ t('common.cancel') }}</button>
            <button type="button" class="btn btn--primary" data-submit="true" :disabled="eligible.length === 0" @click="apply">
                {{ t('renew.apply') }}
            </button>
        </template>
    </BaseDialog>
</template>
