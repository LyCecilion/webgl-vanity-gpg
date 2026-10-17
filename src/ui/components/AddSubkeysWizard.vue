<script setup lang="ts">
import { computed, ref } from 'vue';
import { expectedHashes, expectedMaterials } from '../difficulty.ts';
import { friendlyError, uiError } from '../errors.ts';
import { formatHashes } from '../format.ts';
import { useI18n } from '../i18n/index.ts';
import { addSubkeys } from '../operations.ts';
import { preferences } from '../preferences.ts';
import { askConfirmation, certificate, closeDialog, currentDocument, hasDocument } from '../store.ts';
import { validateNonNegativeInteger, validatePrefix, validateProtection } from '../validation.ts';
import { defaultExpiry, defaultTimeWindow, describeWindow, expiresAtFrom, resolveWindow } from '../window.ts';
import type { ExpiryValue, TimeWindowValue } from '../window.ts';
import BaseDialog from './BaseDialog.vue';
import ComputeField from './ComputeField.vue';
import type { ComputeValue } from './ComputeField.vue';
import ExpiryField from './ExpiryField.vue';
import NewPassphraseFields from './NewPassphraseFields.vue';
import PrefixField from './PrefixField.vue';
import PassphraseInput from './PassphraseInput.vue';
import TimeWindowField from './TimeWindowField.vue';

defineEmits<{ close: [] }>();
const { t, locale } = useI18n();

const steps = ['add.step.targets', 'add.step.time', 'add.step.protection', 'add.step.review'] as const;
const step = ref(0);
const error = ref('');
const errorDetail = ref('');

const signing = ref(1);
const encryption = ref(false);
const prefix = ref('4217');
const windowValue = ref<TimeWindowValue>(defaultTimeWindow(preferences.viewZone, 'today'));
const expiry = ref<ExpiryValue>(defaultExpiry(windowValue.value.zone, 365));
const primaryPassphrase = ref('');
const passphrase = ref('');
const confirmation = ref('');
const allowUnprotected = ref(false);
const compute = ref<ComputeValue>({
    preset: preferences.computePreset,
    threads: preferences.threads,
    iterations: preferences.iterations,
});

const primaryCreated = computed(() => currentDocument.value?.key.getCreationTime());
const primaryProtected = computed(() => certificate.rows[0]?.secret === 'protected');

const reviewWindow = computed(() => {
    try {
        const now = new Date();
        const range = resolveWindow(windowValue.value, now, primaryCreated.value);
        return describeWindow(range, windowValue.value.zone, now, primaryCreated.value, locale.value);
    } catch {
        return '';
    }
});

const count = computed(() => Math.max(0, Math.trunc(Number(signing.value) || 0)) + (encryption.value ? 1 : 0));
const reviewExpiry = computed(() => expiry.value.mode === 'never' ? t('create.expiryNever') : expiry.value.date);

const windowInfo = computed(() => {
    try {
        const now = new Date();
        const range = resolveWindow(windowValue.value, now, primaryCreated.value);
        return { range, length: range.end - range.start + 1 };
    } catch {
        return null;
    }
});

const materialEstimate = computed(() => {
    const info = windowInfo.value;
    if (!info) return null;
    const expected = expectedHashes(prefix.value.replace(/\s+/g, '').length);
    return { expected, materials: expectedMaterials(expected, info.length) };
});

function validateStep(index: number): boolean {
    error.value = '';
    errorDetail.value = '';
    try {
        if (index === 0) {
            validateNonNegativeInteger(signing.value);
            const total = count.value;
            if (total === 0) throw uiError('add.targetNote');
            validatePrefix(prefix.value);
        } else if (index === 1) {
            const now = new Date();
            resolveWindow(windowValue.value, now, primaryCreated.value);
            const expiresAt = expiresAtFrom(expiry.value, windowValue.value.zone);
            if (expiresAt && expiresAt.getTime() <= now.getTime()) throw uiError('error.expiryPast');
        } else if (index === 2) {
            if (primaryProtected.value && !primaryPassphrase.value) throw uiError('error.passphraseRequired');
            validateProtection(passphrase.value, confirmation.value, allowUnprotected.value);
            if (!Number.isSafeInteger(compute.value.threads) || compute.value.threads <= 0) throw uiError('error.positiveInteger');
            if (!Number.isSafeInteger(compute.value.iterations) || compute.value.iterations <= 0) throw uiError('error.positiveInteger');
        }
        return true;
    } catch (caught) {
        const friendly = friendlyError(caught, locale.value);
        error.value = friendly.message;
        errorDetail.value = friendly.detail ?? '';
        return false;
    }
}

function next(): void {
    if (!validateStep(step.value)) return;
    step.value = Math.min(step.value + 1, steps.length - 1);
}

function back(): void {
    error.value = '';
    errorDetail.value = '';
    step.value = Math.max(0, step.value - 1);
}

async function start(): Promise<void> {
    if (!hasDocument.value) {
        error.value = t('dash.blocked.noDocument');
        return;
    }
    for (let index = 0; index < steps.length; index++) {
        if (!validateStep(index)) {
            step.value = index;
            return;
        }
    }
    const now = new Date();
    let range;
    let windowText: string;
    try {
        range = resolveWindow(windowValue.value, now, primaryCreated.value);
        windowText = describeWindow(range, windowValue.value.zone, now, primaryCreated.value, locale.value);
    } catch (caught) {
        const friendly = friendlyError(caught, locale.value);
        error.value = friendly.message;
        errorDetail.value = friendly.detail ?? '';
        step.value = 1;
        return;
    }
    const expiresAt = expiresAtFrom(expiry.value, windowValue.value.zone);
    const protection = validateProtection(passphrase.value, confirmation.value, allowUnprotected.value);
    const estimate = materialEstimate.value;
    if (estimate && windowInfo.value && (estimate.materials > 512 || windowInfo.value.length < 60)) {
        const confirmed = await askConfirmation({
            title: t('add.review.slowTitle'),
            message: t('add.review.slowMessage', { seconds: windowInfo.value.length, materials: estimate.materials.toLocaleString() }),
            confirmLabel: t('common.continue'),
            cancelLabel: t('common.cancel'),
            danger: false,
        });
        if (!confirmed) return;
    }
    const request = {
        signing: Math.trunc(Number(signing.value) || 0),
        encryption: encryption.value ? 1 : 0,
        prefix: prefix.value,
        window: range,
        windowText,
        expiresAt,
        primaryPassphrase: primaryPassphrase.value,
        protection,
        threads: compute.value.threads,
        iterations: compute.value.iterations,
    };
    closeDialog();
    void addSubkeys(request);
}
</script>

<template>
    <BaseDialog :title="t('add.title')" :subtitle="t('add.subtitle')" size="wide" :close-label="t('common.close')" @close="$emit('close')">
        <div class="wizard">
            <ol class="wizard__steps">
                <li
                    v-for="(key, index) in steps"
                    :key="key"
                    class="wizard__step"
                    :class="{ 'wizard__step--active': step === index, 'wizard__step--done': step > index }"
                    :aria-current="step === index ? 'step' : undefined"
                >
                    <span class="wizard__step-num">{{ index + 1 }}</span>
                    <span class="wizard__step-label">{{ t(key) }}</span>
                </li>
            </ol>

            <div v-if="error" class="banner banner--danger" role="alert">
                <div class="banner__body">
                    <p class="banner__title">{{ error }}</p>
                    <p v-if="errorDetail" class="banner__desc">{{ errorDetail }}</p>
                </div>
            </div>

            <div class="wizard__body">
                <template v-if="step === 0">
                    <div class="grid-2">
                        <div class="field">
                            <label class="field__label" for="add-signing">{{ t('add.signingCount') }}</label>
                            <input id="add-signing" v-model.number="signing" class="input mono" type="number" min="0" step="1">
                            <p class="field__hint">{{ t('add.signingCountHint') }}</p>
                        </div>
                        <div class="field">
                            <label class="checkbox">
                                <input id="add-encryption" v-model="encryption" type="checkbox">
                                <span>{{ t('add.encryption') }}</span>
                            </label>
                            <p class="field__hint">{{ t('add.encryptionHint') }}</p>
                        </div>
                    </div>
                    <PrefixField id="add-prefix" v-model="prefix" :label="t('add.prefix')" :hint="t('add.prefixHint')" />
                </template>

                <template v-else-if="step === 1">
                    <TimeWindowField id-prefix="add-window" v-model="windowValue" :not-before="primaryCreated" />
                    <div v-if="windowInfo && materialEstimate && materialEstimate.materials > 256" class="banner banner--warning" role="status">
                        <div class="banner__body">
                            <p class="banner__desc">{{ t('add.review.slowHint', { seconds: windowInfo.length.toLocaleString(), materials: materialEstimate.materials.toLocaleString() }) }}</p>
                        </div>
                    </div>
                    <ExpiryField id-prefix="add-expiry" v-model="expiry" :zone="windowValue.zone" :hint="t('add.expiryHint')" />
                </template>

                <template v-else-if="step === 2">
                    <PassphraseInput
                        id="add-primary-passphrase"
                        v-model="primaryPassphrase"
                        :label="t('add.primaryPassphrase')"
                        :hint="t('add.primaryPassphraseHint')"
                        autocomplete="current-password"
                    />
                    <NewPassphraseFields
                        id-prefix="add-protect"
                        :passphrase="passphrase"
                        :confirmation="confirmation"
                        :allow-unprotected="allowUnprotected"
                        :passphrase-label="t('add.newPassphrase')"
                        :confirmation-label="t('add.newPassphraseConfirm')"
                        :allow-label="t('add.allowUnprotected')"
                        @update:passphrase="passphrase = $event"
                        @update:confirmation="confirmation = $event"
                        @update:allow-unprotected="allowUnprotected = $event"
                    />
                    <p class="field__hint">{{ t('add.protectionNote') }}</p>
                    <ComputeField v-model="compute" />
                </template>

                <template v-else>
                    <div class="review">
                        <div class="review__row">
                            <span class="review__label">{{ t('add.step.targets') }}</span>
                            <span class="review__value">{{ t('add.review.count', { signing: signing, encryption: encryption ? 1 : 0 }) }}</span>
                        </div>
                        <div class="review__row">
                            <span class="review__label">{{ t('add.prefix') }}</span>
                            <span class="review__value mono">{{ prefix }}</span>
                        </div>
                        <div class="review__row">
                            <span class="review__label">{{ t('create.review.difficulty') }}</span>
                            <span class="review__value">
                                {{ t('add.review.difficulty', { hashes: formatHashes(expectedHashes(prefix.replace(/\s+/g, '').length)) }) }}
                            </span>
                        </div>
                        <div class="review__row">
                            <span class="review__label">{{ t('add.window.title') }}</span>
                            <span class="review__value">{{ reviewWindow }}</span>
                        </div>
                        <div v-if="windowInfo" class="review__row">
                            <span class="review__label">{{ t('add.review.windowLengthLabel') }}</span>
                            <span class="review__value">
                                {{ t('add.review.windowLength', { seconds: windowInfo.length.toLocaleString() }) }}
                                <template v-if="materialEstimate">· {{ t('add.review.materials', { materials: materialEstimate.materials.toLocaleString() }) }}</template>
                            </span>
                        </div>
                        <div class="review__row">
                            <span class="review__label">{{ t('add.expiry') }}</span>
                            <span class="review__value">{{ reviewExpiry }}</span>
                        </div>
                        <div class="review__row">
                            <span class="review__label">{{ t('create.review.protection') }}</span>
                            <span class="review__value">
                                {{ passphrase ? t('cert.secretProtected') : t('cert.secretUnprotected') }}
                            </span>
                        </div>
                    </div>
                </template>
            </div>
        </div>

        <template #footer>
            <button v-if="step > 0" type="button" class="btn btn--ghost dialog__footer-start" @click="back">
                {{ t('common.back') }}
            </button>
            <button v-if="step < steps.length - 1" type="button" class="btn btn--primary" data-submit="true" @click="next">
                {{ t('common.next') }}
            </button>
            <button v-else type="button" class="btn btn--primary" data-submit="true" @click="start">
                {{ t('add.review.start') }}
            </button>
        </template>
    </BaseDialog>
</template>
