<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { copyText } from '../browser.ts';
import { formatDateTime, shortFingerprint } from '../format.ts';
import { useI18n } from '../i18n/index.ts';
import { confirmBackupSaved, exportBackup, exportDevice, exportPublicKey, publicKeyText } from '../operations.ts';
import { preferences } from '../preferences.ts';
import {
    certificate,
    deviceEligibility,
    pushToast,
    ui,
} from '../store.ts';
import type { CertificateRow } from '../store.ts';
import { validateProtection } from '../validation.ts';
import BaseDialog from './BaseDialog.vue';
import Icon from './Icon.vue';
import NewPassphraseFields from './NewPassphraseFields.vue';
import PassphraseInput from './PassphraseInput.vue';
import RoleBadges from './RoleBadges.vue';

const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();

const tabs = computed(() => ([
    { id: 'public', label: t('export.tab.public') },
    { id: 'backup', label: t('export.tab.backup') },
    { id: 'device', label: t('export.tab.device') },
] as const));
const tab = ref(ui.exportTab);

// Public key ---------------------------------------------------------------
function downloadPublic(): void {
    void exportPublicKey();
}

async function copyPublic(): Promise<void> {
    try {
        if (await copyText(publicKeyText())) pushToast('success', t('export.public.copied'));
        else pushToast('error', t('error.clipboard'));
    } catch {
        pushToast('error', t('error.clipboard'));
    }
}

// Full backup -------------------------------------------------------------
const acknowledged = ref(false);
const backupChecksum = ref('');

async function downloadBackup(): Promise<void> {
    if (!acknowledged.value) return;
    const result = await exportBackup();
    if (result) backupChecksum.value = result.checksum;
}

function confirmBackup(): void {
    confirmBackupSaved();
}

// Device key --------------------------------------------------------------
const subkeys = computed(() => certificate.rows.filter(row => !row.primary));
const selection = reactive<Record<string, boolean>>({});
for (const row of subkeys.value) {
    selection[row.fingerprint] = ui.devicePreselect.includes(row.fingerprint) && deviceEligibility(row) === null;
}
const passphrases = reactive<Record<string, string>>({});
const deviceName = ref('');
const passphrase = ref('');
const confirmation = ref('');
const allowUnprotected = ref(false);
const deviceError = ref('');
const deviceErrorDetail = ref('');
const deviceResult = ref<{ filename: string; checksum: string } | null>(null);

const selectedRows = computed(() => certificate.rows.filter(row => selection[row.fingerprint] === true && deviceEligibility(row) === null));

function expiryText(row: CertificateRow): string {
    if (!row.expirationKnown) return t('cert.invalid');
    if (row.expirationMs === null) return t('cert.expiryNever');
    return formatDateTime(row.expirationMs, preferences.viewZone);
}

function labelOf(row: CertificateRow): string {
    const role = row.role === 'signing' ? t('cert.sign') : row.role === 'encryption' ? t('cert.encrypt') : t('cert.unknownRole');
    return `${role} ${shortFingerprint(row.fingerprint)}`;
}

const included = computed(() => selectedRows.value.map(labelOf));
const excluded = computed(() => {
    const items = [t('cert.primary')];
    for (const row of certificate.rows) {
        if (row.primary) continue;
        if (selection[row.fingerprint] === true && deviceEligibility(row) === null) continue;
        items.push(labelOf(row));
    }
    return items;
});

async function exportSelectedDevice(): Promise<void> {
    deviceError.value = '';
    deviceErrorDetail.value = '';
    deviceResult.value = null;
    try {
        if (selectedRows.value.length === 0) throw new Error(t('error.selectionRequired'));
        const protection = validateProtection(passphrase.value, confirmation.value, allowUnprotected.value);
        const result = await exportDevice({
            fingerprints: selectedRows.value.map(row => row.fingerprint),
            passphrases: { ...passphrases },
            deviceName: deviceName.value,
            protection,
        });
        if (result) {
            deviceResult.value = result;
            passphrase.value = '';
            confirmation.value = '';
        }
    } catch (error) {
        deviceError.value = error instanceof Error ? error.message : String(error);
    }
}
</script>

<template>
    <BaseDialog :title="t('export.title')" :subtitle="t('export.subtitle')" size="wide" :close-label="t('common.close')" @close="emit('close')">
        <div class="tabs" role="tablist" :aria-label="t('export.title')">
            <button
                v-for="item in tabs"
                :key="item.id"
                type="button"
                class="tab"
                :class="{ 'tab--active': tab === item.id }"
                role="tab"
                :aria-selected="tab === item.id"
                @click="tab = item.id"
            >
                {{ item.label }}
            </button>
        </div>

        <template v-if="tab === 'public'">
            <p class="muted" style="font-size: var(--text-sm)">{{ t('export.public.desc') }}</p>
            <div class="btn-row" style="margin-top: var(--space-4)">
                <button type="button" class="btn btn--primary" @click="downloadPublic">
                    <Icon name="download" :size="15" />
                    {{ t('export.public.download') }}
                </button>
                <button type="button" class="btn btn--secondary" @click="copyPublic">
                    <Icon name="copy" :size="15" />
                    {{ t('export.public.copy') }}
                </button>
            </div>
        </template>

        <template v-else-if="tab === 'backup'">
            <p class="muted" style="font-size: var(--text-sm)">{{ t('export.backup.desc') }}</p>
            <div class="banner banner--warning" style="margin-top: var(--space-3)">
                <div class="banner__body">
                    <p class="banner__desc">{{ t('export.backup.warning') }}</p>
                </div>
            </div>
            <label class="checkbox" style="margin-top: var(--space-4)">
                <input v-model="acknowledged" type="checkbox">
                <span>{{ t('export.backup.ack') }}</span>
            </label>
            <div class="btn-row" style="margin-top: var(--space-3)">
                <button type="button" class="btn btn--primary" :disabled="!acknowledged" @click="downloadBackup">
                    <Icon name="download" :size="15" />
                    {{ t('export.backup.download') }}
                </button>
                <button
                    v-if="certificate.backupStarted"
                    type="button"
                    class="btn btn--secondary"
                    @click="confirmBackup"
                >
                    <Icon name="check" :size="15" />
                    {{ t('export.backup.confirm') }}
                </button>
            </div>
            <p v-if="certificate.backupStarted" class="field__hint" style="margin-top: var(--space-2)">
                {{ t('export.backup.started') }}
            </p>
            <p v-if="backupChecksum" class="field__hint mono" style="margin-top: var(--space-2)">
                {{ t('export.backup.checksum', { checksum: backupChecksum }) }}
            </p>
        </template>

        <template v-else>
            <p class="muted" style="font-size: var(--text-sm)">{{ t('export.device.desc') }}</p>
            <div v-if="deviceError" class="banner banner--danger" role="alert" style="margin-top: var(--space-3)">
                <div class="banner__body">
                    <p class="banner__title">{{ deviceError }}</p>
                    <p v-if="deviceErrorDetail" class="banner__desc">{{ deviceErrorDetail }}</p>
                </div>
            </div>

            <div v-if="deviceResult" class="banner banner--success" style="margin-top: var(--space-3)">
                <div class="banner__body">
                    <p class="banner__title">{{ t('export.device.success', { filename: deviceResult.filename }) }}</p>
                    <p class="banner__desc mono">{{ t('export.device.checksum', { checksum: deviceResult.checksum }) }}</p>
                </div>
            </div>

            <h3 class="card__title" style="margin-top: var(--space-4)">{{ t('export.device.select') }}</h3>
            <p class="field__hint">{{ t('export.device.selectHint') }}</p>

            <ul v-if="subkeys.length > 0" class="selection-list" style="margin-top: var(--space-2)">
                <li
                    v-for="row in subkeys"
                    :key="row.fingerprint"
                    class="selection-item"
                    :class="{ 'selection-item--disabled': deviceEligibility(row) !== null }"
                >
                    <input
                        :id="`device-${row.fingerprint}`"
                        v-model="selection[row.fingerprint]"
                        type="checkbox"
                        :disabled="deviceEligibility(row) !== null"
                        style="margin-top: 0.3rem"
                    >
                    <div class="selection-item__body">
                        <label :for="`device-${row.fingerprint}`" class="selection-item__title">
                            <RoleBadges :usage="row.usage" />
                            <code>{{ shortFingerprint(row.fingerprint) }}</code>
                            <span class="muted">{{ expiryText(row) }}</span>
                        </label>
                        <p v-if="deviceEligibility(row)" class="field__hint">{{ t(deviceEligibility(row)!) }}</p>
                        <PassphraseInput
                            v-if="selection[row.fingerprint] && deviceEligibility(row) === null"
                            :id="`device-passphrase-${row.fingerprint}`"
                            v-model="passphrases[row.fingerprint]"
                            :label="t('export.device.passphrase')"
                            :hint="t('export.device.passphraseHint')"
                            autocomplete="current-password"
                        />
                    </div>
                </li>
            </ul>
            <p v-else class="muted">{{ t('dash.noSubkeys') }}</p>

            <div v-if="selectedRows.length > 0" class="scope" style="margin-top: var(--space-3)">
                <p class="scope__label">{{ t('export.device.scopeTitle') }}</p>
                <div class="scope__row">
                    <span class="scope__label">{{ t('export.device.includeTitle') }}</span>
                    <ul class="scope__items">
                        <li v-for="item in included" :key="item">{{ item }}</li>
                    </ul>
                </div>
                <div class="scope__row">
                    <span class="scope__label">{{ t('export.device.excludeTitle') }}</span>
                    <ul class="scope__items">
                        <li v-for="item in excluded" :key="item">{{ item }}</li>
                    </ul>
                </div>
            </div>

            <div class="field" style="margin-top: var(--space-4)">
                <label class="field__label" for="device-name">{{ t('export.device.name') }}</label>
                <input id="device-name" v-model="deviceName" class="input" autocomplete="off">
                <p class="field__hint">{{ t('export.device.nameHint') }}</p>
            </div>

            <NewPassphraseFields
                id-prefix="device-protect"
                :passphrase="passphrase"
                :confirmation="confirmation"
                :allow-unprotected="allowUnprotected"
                :passphrase-label="t('export.device.newPassphrase')"
                :confirmation-label="t('export.device.confirm')"
                :allow-label="t('export.device.allowUnprotected')"
                @update:passphrase="passphrase = $event"
                @update:confirmation="confirmation = $event"
                @update:allow-unprotected="allowUnprotected = $event"
            />

            <div class="btn-row">
                <button type="button" class="btn btn--primary" :disabled="selectedRows.length === 0" @click="exportSelectedDevice">
                    <Icon name="download" :size="15" />
                    {{ t('export.device.export') }}
                </button>
            </div>
            <p class="field__hint" style="margin-top: var(--space-2)">{{ t('export.device.note') }}</p>
        </template>

        <template #footer>
            <button type="button" class="btn btn--secondary" @click="emit('close')">{{ t('common.close') }}</button>
        </template>
    </BaseDialog>
</template>
