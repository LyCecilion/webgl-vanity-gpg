<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '../i18n/index.ts';
import type { MessageKey } from '../i18n/messages.ts';

const props = defineProps<{ usage: readonly string[] }>();
const { t } = useI18n();

const entries = computed(() => props.usage.map((code) => {
    const key: MessageKey | undefined = code === 'C'
        ? 'cert.flagCertify'
        : code === 'S'
            ? 'cert.flagSign'
            : code === 'E'
                ? 'cert.flagEncrypt'
                : code === 'A'
                    ? 'cert.flagAuth'
                    : undefined;
    const tone = code === 'C' ? 'certify' : code === 'S' ? 'sign' : code === 'E' ? 'encrypt' : 'unknown';
    return { code, tone, label: key ? t(key) : code };
}));
</script>

<template>
    <span
        v-for="entry in entries"
        :key="entry.code"
        class="role-badge"
        :class="`role-badge--${entry.tone}`"
        :title="entry.label"
        :aria-label="entry.label"
    >
        {{ entry.code }}
    </span>
</template>
