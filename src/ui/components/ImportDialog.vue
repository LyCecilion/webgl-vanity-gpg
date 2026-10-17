<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import type { KeyDocument } from '../../key-document.ts';
import { friendlyError } from '../errors.ts';
import { fingerprintGroups } from '../format.ts';
import { useI18n } from '../i18n/index.ts';
import { commitImport, previewImport } from '../operations.ts';
import { certificate, hasDocument, askConfirmation } from '../store.ts';
import { readFileText } from '../browser.ts';
import BaseDialog from './BaseDialog.vue';
import CopyButton from './CopyButton.vue';
import Icon from './Icon.vue';

const emit = defineEmits<{ close: [] }>();
const { t, locale } = useI18n();

const text = ref('');
const sourceName = ref('');
const parsing = ref(false);
const document = shallowRef<KeyDocument | undefined>(undefined);
const error = ref('');
const errorDetail = ref('');
const dragActive = ref(false);
const fileInput = ref<HTMLInputElement>();

const primaryIsDummy = computed(() => {
    if (!document.value) return false;
    const packet = document.value.key.keyPacket as unknown as { isDummy(): boolean };
    return packet.isDummy();
});

const keyCount = computed(() => document.value ? 1 + document.value.key.subkeys.length : 0);

function resetPreview(): void {
    document.value = undefined;
}

async function parse(): Promise<void> {
    error.value = '';
    errorDetail.value = '';
    document.value = undefined;
    if (!text.value.trim()) {
        error.value = t('import.errorEmpty');
        return;
    }
    parsing.value = true;
    try {
        document.value = await previewImport(text.value);
    } catch (caught) {
        const friendly = friendlyError(caught, locale.value);
        error.value = friendly.message;
        errorDetail.value = friendly.detail ?? '';
    } finally {
        parsing.value = false;
    }
}

async function onFile(file: File): Promise<void> {
    error.value = '';
    errorDetail.value = '';
    try {
        text.value = await readFileText(file);
        sourceName.value = file.name;
        await parse();
    } catch (caught) {
        const friendly = friendlyError(caught, locale.value);
        error.value = t('import.errorRead');
        errorDetail.value = friendly.detail ?? '';
    }
}

function onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void onFile(file);
    input.value = '';
}

function onDrop(event: DragEvent): void {
    dragActive.value = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) void onFile(file);
}

function chooseFile(): void {
    fileInput.value?.click();
}

async function confirm(): Promise<void> {
    if (!document.value) return;
    if (hasDocument.value) {
        const ok = await askConfirmation({
            title: t('import.previewTitle'),
            message: hasDocument.value && certificate.dirtyBackup
                ? `${t('import.replaceWarning')} ${t('dash.backup.dirtyTitle')}`
                : t('import.replaceWarning'),
            confirmLabel: t('import.confirm'),
            cancelLabel: t('common.cancel'),
            danger: true,
        });
        if (!ok) return;
    }
    await commitImport(document.value);
    emit('close');
}
</script>

<template>
    <BaseDialog :title="t('import.title')" :subtitle="t('import.desc')" size="wide" :close-label="t('common.close')" @close="emit('close')">
        <div
            class="dropzone"
            :class="{ 'dropzone--active': dragActive }"
            role="button"
            tabindex="0"
            @click="chooseFile"
            @keydown.enter="chooseFile"
            @keydown.space.prevent="chooseFile"
            @dragover.prevent="dragActive = true"
            @dragleave.prevent="dragActive = false"
            @drop.prevent="onDrop"
        >
            <Icon name="upload" :size="26" />
            <p class="dropzone__title">{{ t('import.drop') }}</p>
            <p class="dropzone__hint">{{ t('import.dropHint') }}</p>
            <input id="import-file-input" ref="fileInput" class="sr-only" type="file" accept=".asc,.gpg,.txt,application/pgp-keys" @change="onFileInput">
        </div>
        <p v-if="sourceName" class="field__hint mono" style="margin-top: var(--space-2)">{{ sourceName }}</p>

        <div class="field" style="margin-top: var(--space-4)">
            <label class="field__label" for="import-text">{{ t('import.pasteLabel') }}</label>
            <textarea
                id="import-text"
                v-model="text"
                class="textarea"
                rows="7"
                spellcheck="false"
                @input="resetPreview"
            />
        </div>

        <div class="btn-row">
            <button type="button" class="btn btn--secondary" :disabled="parsing" @click="parse">
                {{ parsing ? t('import.parsing') : t('import.parse') }}
            </button>
        </div>

        <div v-if="error" class="banner banner--danger" role="alert" style="margin-top: var(--space-4)">
            <div class="banner__body">
                <p class="banner__title">{{ error }}</p>
                <p v-if="errorDetail" class="banner__desc">{{ errorDetail }}</p>
            </div>
        </div>

        <div v-if="document" class="preview" style="margin-top: var(--space-4)">
            <span class="field__label">{{ t('import.previewTitle') }}</span>
            <div class="key-card__title">
                <code class="preview__fingerprint">{{ fingerprintGroups(document.key.getFingerprint()) }}</code>
                <CopyButton :value="document.key.getFingerprint()" :label="t('cert.copyFingerprint')" />
            </div>
            <div class="field__hint">
                {{ t('import.previewKeys') }}: {{ t('import.previewKeysValue', { subkeys: keyCount - 1 }) }}
            </div>
            <div v-if="document.key.getUserIDs().length > 0">
                <span class="field__label">{{ t('import.previewUids') }}</span>
                <ul class="scope__items">
                    <li v-for="uid in document.key.getUserIDs()" :key="uid">{{ uid }}</li>
                </ul>
            </div>
            <p v-if="primaryIsDummy" class="field__hint">{{ t('import.previewDevice') }}</p>
            <p class="field__hint">{{ t('import.replaceWarning') }}</p>
        </div>

        <template #footer>
            <button type="button" class="btn btn--secondary" @click="emit('close')">{{ t('common.cancel') }}</button>
            <button type="button" class="btn btn--primary" data-submit="true" :disabled="!document" @click="confirm">
                {{ t('import.confirm') }}
            </button>
        </template>
    </BaseDialog>
</template>
