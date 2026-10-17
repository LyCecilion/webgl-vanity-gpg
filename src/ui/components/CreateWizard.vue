<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { UserID } from 'openpgp';
import { expectedHashes } from '../difficulty.ts';
import { friendlyError, uiError } from '../errors.ts';
import { formatDateInput, formatHashes } from '../format.ts';
import { useI18n } from '../i18n/index.ts';
import { createPrimary } from '../operations.ts';
import { preferences } from '../preferences.ts';
import { closeDialog } from '../store.ts';
import { validatePrefix, validateProtection } from '../validation.ts';
import { defaultTimeWindow, describeWindow, expiresAtFrom, resolveWindow } from '../window.ts';
import type { ExpiryValue, TimeWindowValue } from '../window.ts';
import BaseDialog from './BaseDialog.vue';
import ComputeField from './ComputeField.vue';
import type { ComputeValue } from './ComputeField.vue';
import ExpiryField from './ExpiryField.vue';
import NewPassphraseFields from './NewPassphraseFields.vue';
import PrefixField from './PrefixField.vue';
import TimeWindowField from './TimeWindowField.vue';

defineEmits<{ close: [] }>();
const { t, locale } = useI18n();

const steps = ['create.step.identity', 'create.step.time', 'create.step.protection', 'create.step.review'] as const;
const step = ref(0);
const error = ref('');
const errorDetail = ref('');

const userIDs = ref<UserID[]>([]);
const uidInput = reactive<UserID>({ name: '', comment: '', email: '' });

const prefix = ref('4A2E117A');
const windowValue = ref<TimeWindowValue>({
    ...defaultTimeWindow(preferences.viewZone, 'day'),
    // Backdate the primary by one day by default so an immediate subkey
    // operation still has a full-day creation window available.
    date: formatDateInput(Date.now() - 86_400_000, preferences.viewZone),
});
const expiry = ref<ExpiryValue>({ mode: 'never', date: '' });
const passphrase = ref('');
const confirmation = ref('');
const allowUnprotected = ref(false);
const compute = ref<ComputeValue>({
    preset: preferences.computePreset,
    threads: preferences.threads,
    iterations: preferences.iterations,
});

const expected = computed(() => {
    const length = prefix.value.replace(/\s+/g, '').length;
    try {
        return expectedHashes(length);
    } catch {
        return null;
    }
});

const reviewWindow = computed(() => {
    try {
        const now = new Date();
        const range = resolveWindow(windowValue.value, now);
        return describeWindow(range, windowValue.value.zone, now, undefined, locale.value);
    } catch {
        return '';
    }
});

const reviewExpiry = computed(() => {
    if (expiry.value.mode === 'never') return t('create.expiryNever');
    return expiry.value.date;
});

function formatUserID(uid: UserID): string {
    const name = (uid.name ?? '').trim();
    const comment = (uid.comment ?? '').trim();
    const email = (uid.email ?? '').trim();
    const head = comment ? `${name} (${comment})` : name;
    return email ? `${head} <${email}>`.trim() : head;
}

function addUid(): void {
    const name = (uidInput.name ?? '').trim();
    const comment = (uidInput.comment ?? '').trim();
    const email = (uidInput.email ?? '').trim();
    if (!name && !comment && !email) {
        error.value = t('create.uidAtLeastOne');
        return;
    }
    userIDs.value.push({ name, comment, email });
    uidInput.name = '';
    uidInput.comment = '';
    uidInput.email = '';
    error.value = '';
    errorDetail.value = '';
}

function removeUid(index: number): void {
    userIDs.value.splice(index, 1);
}

function validateStep(index: number): boolean {
    error.value = '';
    errorDetail.value = '';
    try {
        if (index === 0) {
            if (userIDs.value.length === 0) throw uiError('error.uidRequired');
        } else if (index === 1) {
            validatePrefix(prefix.value);
            const now = new Date();
            resolveWindow(windowValue.value, now);
            const expiresAt = expiresAtFrom(expiry.value, windowValue.value.zone);
            if (expiresAt && expiresAt.getTime() <= now.getTime()) throw uiError('error.expiryPast');
        } else if (index === 2) {
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

function start(): void {
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
        range = resolveWindow(windowValue.value, now);
        windowText = describeWindow(range, windowValue.value.zone, now, undefined, locale.value);
    } catch (caught) {
        const friendly = friendlyError(caught, locale.value);
        error.value = friendly.message;
        errorDetail.value = friendly.detail ?? '';
        step.value = 1;
        return;
    }
    const expiresAt = expiresAtFrom(expiry.value, windowValue.value.zone);
    const protection = validateProtection(passphrase.value, confirmation.value, allowUnprotected.value);
    const identities = userIDs.value.map(uid => ({ ...uid }));
    closeDialog();
    void createPrimary({
        userIDs: identities,
        prefix: prefix.value,
        window: range,
        windowText,
        expiresAt,
        protection,
        threads: compute.value.threads,
        iterations: compute.value.iterations,
    });
}
</script>

<template>
    <BaseDialog :title="t('create.title')" :subtitle="t('create.subtitle')" size="wide" :close-label="t('common.close')" @close="$emit('close')">
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
                <Transition name="step" mode="out-in">
                    <div :key="step" class="wizard__step-panel">
                <template v-if="step === 0">
                    <fieldset class="fieldset">
                        <legend class="fieldset__legend">{{ t('create.uidLabel') }}</legend>
                        <div class="uid-editor">
                            <div class="uid-editor__form">
                                <div class="field" style="margin-bottom: 0">
                                    <label class="field__label" for="create-uid-name">{{ t('create.uidName') }}</label>
                                    <input id="create-uid-name" v-model="uidInput.name" class="input" autocomplete="off" @keydown.enter="addUid">
                                </div>
                                <div class="field" style="margin-bottom: 0">
                                    <label class="field__label" for="create-uid-comment">{{ t('create.uidComment') }}</label>
                                    <input id="create-uid-comment" v-model="uidInput.comment" class="input" autocomplete="off" @keydown.enter="addUid">
                                </div>
                                <div class="field" style="margin-bottom: 0">
                                    <label class="field__label" for="create-uid-email">{{ t('create.uidEmail') }}</label>
                                    <input id="create-uid-email" v-model="uidInput.email" class="input" type="email" autocomplete="off" @keydown.enter="addUid">
                                </div>
                                <button type="button" class="btn btn--secondary uid-editor__submit" @click="addUid">
                                    {{ t('create.uidAdd') }}
                                </button>
                            </div>
                            <ul v-if="userIDs.length > 0" class="uid-chip-list">
                                <li v-for="(uid, index) in userIDs" :key="index" class="uid-chip">
                                    {{ formatUserID(uid) }}
                                    <button type="button" class="uid-chip__remove" :aria-label="t('common.remove')" @click="removeUid(index)">
                                        ×
                                    </button>
                                </li>
                            </ul>
                            <p v-else class="field__hint">{{ t('create.uidEmpty') }}</p>
                        </div>
                    </fieldset>
                </template>

                <template v-else-if="step === 1">
                    <PrefixField id="create-prefix" v-model="prefix" />
                    <TimeWindowField id-prefix="create-window" v-model="windowValue" />
                    <p class="field__hint">{{ t('create.window.backdateHint') }}</p>
                    <ExpiryField id-prefix="create-expiry" v-model="expiry" :zone="windowValue.zone" />
                </template>

                <template v-else-if="step === 2">
                    <NewPassphraseFields
                        id-prefix="create-protect"
                        :passphrase="passphrase"
                        :confirmation="confirmation"
                        :allow-unprotected="allowUnprotected"
                        @update:passphrase="passphrase = $event"
                        @update:confirmation="confirmation = $event"
                        @update:allow-unprotected="allowUnprotected = $event"
                    />
                    <ComputeField v-model="compute" />
                </template>

                <template v-else>
                    <div class="review">
                        <div class="review__row">
                            <span class="review__label">{{ t('create.review.identity') }}</span>
                            <span class="review__value">{{ userIDs.map(formatUserID).join(' · ') }}</span>
                        </div>
                        <div class="review__row">
                            <span class="review__label">{{ t('create.review.prefix') }}</span>
                            <span class="review__value mono">{{ prefix }}</span>
                        </div>
                        <div class="review__row">
                            <span class="review__label">{{ t('create.review.difficulty') }}</span>
                            <span class="review__value">
                                {{ expected ? t('difficulty.expected', { hashes: formatHashes(expected) }) : '—' }}
                            </span>
                        </div>
                        <div class="review__row">
                            <span class="review__label">{{ t('create.review.window') }}</span>
                            <span class="review__value">{{ reviewWindow }}</span>
                        </div>
                        <div class="review__row">
                            <span class="review__label">{{ t('create.review.expiry') }}</span>
                            <span class="review__value">{{ reviewExpiry }}</span>
                        </div>
                        <div class="review__row">
                            <span class="review__label">{{ t('create.review.protection') }}</span>
                            <span class="review__value">
                                {{ passphrase ? t('cert.secretProtected') : t('cert.secretUnprotected') }}
                            </span>
                        </div>
                        <div class="review__row">
                            <span class="review__label">{{ t('create.review.compute') }}</span>
                            <span class="review__value">{{ compute.threads }} / {{ compute.iterations }}</span>
                        </div>
                    </div>
                </template>
                    </div>
                </Transition>
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
                {{ t('create.review.start') }}
            </button>
        </template>
    </BaseDialog>
</template>
