<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue';
import { useI18n } from './i18n/index.ts';
import { backupNeedsAttention, closeDialog, hasDocument, operation, stopOperation, ui } from './store.ts';
import AddSubkeysWizard from './components/AddSubkeysWizard.vue';
import AppTopBar from './components/AppTopBar.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import CreateWizard from './components/CreateWizard.vue';
import DashboardView from './components/DashboardView.vue';
import EmptyState from './components/EmptyState.vue';
import ExportDialog from './components/ExportDialog.vue';
import HelpDialog from './components/HelpDialog.vue';
import ImportDialog from './components/ImportDialog.vue';
import KeyDetailDialog from './components/KeyDetailDialog.vue';
import OperationOverlay from './components/OperationOverlay.vue';
import RenewDialog from './components/RenewDialog.vue';
import ResultDialog from './components/ResultDialog.vue';
import SettingsDialog from './components/SettingsDialog.vue';
import ToastHost from './components/ToastHost.vue';

const { t, locale } = useI18n();

watch(locale, (value) => {
    document.documentElement.lang = value;
    document.title = t('app.name');
}, { immediate: true });

function beforeUnloadHandler(event: BeforeUnloadEvent): void {
    event.preventDefault();
    event.returnValue = '';
}

watch(backupNeedsAttention, (needed) => {
    if (needed) window.addEventListener('beforeunload', beforeUnloadHandler);
    else window.removeEventListener('beforeunload', beforeUnloadHandler);
}, { immediate: true });

function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && operation.active && operation.cancellable) {
        event.preventDefault();
        stopOperation();
        return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        const submit = document.querySelector<HTMLButtonElement>('dialog[open] [data-submit="true"]');
        if (submit && !submit.disabled) {
            event.preventDefault();
            submit.click();
        }
    }
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown);
    window.removeEventListener('beforeunload', beforeUnloadHandler);
});
</script>

<template>
    <div class="app-shell">
        <a class="skip-link" href="#main-content">{{ t('app.skipToContent') }}</a>
        <AppTopBar />
        <main id="main-content" class="app-main">
            <DashboardView v-if="hasDocument" />
            <EmptyState v-else />
        </main>
        <footer class="app-footer">
            <p>{{ t('app.footerNote') }}</p>
            <p>
                <a href="https://github.com/TransparentLC/webgl-vanity-gpg" target="_blank" rel="noopener noreferrer">
                    {{ t('app.sourceCode') }} · TransparentLC
                </a>
                <span aria-hidden="true"> · </span>
                <a href="https://github.com/LyCecilion/webgl-vanity-gpg" target="_blank" rel="noopener noreferrer">
                    LyCecilion fork
                </a>
            </p>
        </footer>

        <ToastHost />
        <ConfirmDialog />

        <CreateWizard v-if="ui.dialog === 'create'" @close="closeDialog" />
        <ImportDialog v-if="ui.dialog === 'import'" @close="closeDialog" />
        <AddSubkeysWizard v-if="ui.dialog === 'add'" @close="closeDialog" />
        <RenewDialog v-if="ui.dialog === 'renew'" @close="closeDialog" />
        <ExportDialog v-if="ui.dialog === 'export'" @close="closeDialog" />
        <SettingsDialog v-if="ui.dialog === 'settings'" @close="closeDialog" />
        <HelpDialog v-if="ui.dialog === 'help'" @close="closeDialog" />
        <KeyDetailDialog v-if="ui.dialog === 'details'" @close="closeDialog" />
        <ResultDialog v-if="ui.dialog === 'result'" @close="closeDialog" />
        <OperationOverlay v-if="operation.active" />
    </div>
</template>
