import { computed } from 'vue';
import { preferences } from '../preferences.ts';
import { translate } from './translate.ts';
import type { MessageParams } from './translate.ts';
import type { Locale, MessageKey } from './messages.ts';

export function useI18n() {
    const locale = computed(() => preferences.locale);
    const t = (key: MessageKey, params?: MessageParams): string => translate(locale.value, key, params);
    const setLocale = (next: Locale): void => {
        preferences.locale = next;
        document.documentElement.lang = next;
        document.title = translate(next, 'app.name');
    };
    return { locale, t, setLocale };
}
