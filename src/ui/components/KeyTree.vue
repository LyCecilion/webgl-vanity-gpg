<script setup lang="ts">
import type { CertificateRow } from '../store.ts';
import KeyCard from './KeyCard.vue';

defineProps<{ rows: CertificateRow[]; uids: string[] }>();
const emit = defineEmits<{ details: [fingerprint: string]; renew: [fingerprint: string]; device: [fingerprint: string] }>();
</script>

<template>
    <div class="key-tree">
        <template v-if="rows.length > 0">
            <KeyCard
                :row="rows[0]"
                :uids="uids"
                @details="emit('details', $event)"
                @renew="emit('renew', $event)"
                @device="emit('device', $event)"
            />
            <div v-if="rows.length > 1" class="key-card__children">
                <KeyCard
                    v-for="row in rows.slice(1)"
                    :key="row.fingerprint"
                    :row="row"
                    :uids="[]"
                    @details="emit('details', $event)"
                    @renew="emit('renew', $event)"
                    @device="emit('device', $event)"
                />
            </div>
        </template>
    </div>
</template>
