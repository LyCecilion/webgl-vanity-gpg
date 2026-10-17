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
            <TransitionGroup
                v-if="rows.length > 1"
                name="key"
                tag="div"
                class="key-card__children"
            >
                <KeyCard
                    v-for="(row, index) in rows.slice(1)"
                    :key="row.fingerprint"
                    :style="{ '--key-index': index }"
                    :row="row"
                    :uids="[]"
                    @details="emit('details', $event)"
                    @renew="emit('renew', $event)"
                    @device="emit('device', $event)"
                />
            </TransitionGroup>
        </template>
    </div>
</template>
