<script setup lang="ts">
import { useI18n } from '../i18n/index.ts';
import { openDialog } from '../store.ts';
import Icon from './Icon.vue';

const { t } = useI18n();
</script>

<template>
    <section class="empty">
        <div class="empty__hero">
            <h1 class="empty__title">{{ t('empty.title') }}</h1>
            <p class="empty__subtitle">{{ t('empty.subtitle') }}</p>
        </div>

        <div class="empty__actions">
            <button type="button" class="action-card" @click="openDialog('create')">
                <span class="action-card__icon"><Icon name="key" :size="22" /></span>
                <span class="action-card__title">{{ t('empty.createTitle') }}</span>
                <span class="action-card__desc">{{ t('empty.createDesc') }}</span>
                <span class="action-card__arrow">{{ t('empty.createAction') }} →</span>
            </button>
            <button type="button" class="action-card" @click="openDialog('import')">
                <span class="action-card__icon"><Icon name="upload" :size="22" /></span>
                <span class="action-card__title">{{ t('empty.importTitle') }}</span>
                <span class="action-card__desc">{{ t('empty.importDesc') }}</span>
                <span class="action-card__arrow">{{ t('empty.importAction') }} →</span>
            </button>
        </div>

        <div class="how">
            <h2 class="how__title">{{ t('empty.howTitle') }}</h2>
            <div class="how__grid">
                <div class="how__step">
                    <span class="how__step-num">01</span>
                    <p>{{ t('empty.howStep1') }}</p>
                </div>
                <div class="how__step">
                    <span class="how__step-num">02</span>
                    <p>{{ t('empty.howStep2') }}</p>
                </div>
                <div class="how__step">
                    <span class="how__step-num">03</span>
                    <p>{{ t('empty.howStep3') }}</p>
                </div>
            </div>
            <p class="empty__note">
                {{ t('empty.localNote') }}
            </p>
        </div>
    </section>
</template>
