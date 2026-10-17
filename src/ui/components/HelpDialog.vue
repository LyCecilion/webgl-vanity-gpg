<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '../i18n/index.ts';
import BaseDialog from './BaseDialog.vue';
import CopyButton from './CopyButton.vue';

const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();

const commands = computed(() => [
    { label: t('help.gpg.import'), command: 'gpg --import backup.asc' },
    { label: t('help.gpg.list'), command: 'gpg --list-keys --with-subkey-fingerprint' },
    { label: t('help.gpg.sign'), command: 'gpg --local-user <fingerprint>! --detach-sign file' },
    { label: t('help.gpg.encrypt'), command: 'gpg --recipient <fingerprint>! --encrypt file' },
    { label: t('help.gpg.device'), command: 'gpg --import device.asc' },
]);
</script>

<template>
    <BaseDialog :title="t('help.title')" :subtitle="t('help.intro')" size="wide" :close-label="t('common.close')" @close="emit('close')">
        <section class="help__section">
            <h3 class="help__title">{{ t('help.how.title') }}</h3>
            <p>{{ t('help.how.p1') }}</p>
            <p>{{ t('help.how.p2') }}</p>
            <p>{{ t('help.how.p3') }}</p>
        </section>

        <section class="help__section">
            <h3 class="help__title">{{ t('help.security.title') }}</h3>
            <p>{{ t('help.security.p1') }}</p>
            <p>{{ t('help.security.p2') }}</p>
            <p>{{ t('help.security.p3') }}</p>
        </section>

        <section class="help__section">
            <h3 class="help__title">{{ t('help.gpg.title') }}</h3>
            <p>{{ t('help.gpg.p1') }}</p>
            <div class="help__commands">
                <div v-for="item in commands" :key="item.command" class="help__command">
                    <span class="help__command-label">{{ item.label }}</span>
                    <code>{{ item.command }}</code>
                    <CopyButton :value="item.command" :label="t('common.copy')" :copied-label="t('common.copied')" />
                </div>
            </div>
        </section>

        <section class="help__section">
            <h3 class="help__title">{{ t('help.shortcuts.title') }}</h3>
            <dl class="shortcut-list">
                <dt><kbd>Esc</kbd></dt>
                <dd>{{ t('help.shortcuts.stop') }}</dd>
                <dt><kbd>Esc</kbd></dt>
                <dd>{{ t('help.shortcuts.close') }}</dd>
                <dt><kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>Enter</kbd></dt>
                <dd>{{ t('help.shortcuts.submit') }}</dd>
            </dl>
        </section>

        <section class="help__section">
            <h3 class="help__title">{{ t('help.links.title') }}</h3>
            <p>{{ t('help.links.p1') }}</p>
            <p>
                <a href="https://www.douban.com/note/763978955/" target="_blank" rel="noopener noreferrer">一位 PGP 进步青年的科学算号实践</a>
                <span aria-hidden="true"> · </span>
                <a href="https://blog.dejavu.moe/posts/the-scientific-vanity-pgp-counting-guide/" target="_blank" rel="noopener noreferrer">某科学的 PGP 算号指南</a>
                <span aria-hidden="true"> · </span>
                <a href="https://github.com/TransparentLC/opencl_vanity_gpg" target="_blank" rel="noopener noreferrer">opencl_vanity_gpg</a>
            </p>
        </section>

        <section class="help__section">
            <h3 class="help__title">{{ t('help.about.title') }}</h3>
            <p>{{ t('help.about.p1') }}</p>
        </section>

        <template #footer>
            <button type="button" class="btn btn--secondary" @click="emit('close')">{{ t('common.close') }}</button>
        </template>
    </BaseDialog>
</template>
