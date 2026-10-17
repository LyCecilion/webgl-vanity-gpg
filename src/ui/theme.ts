import { computed, ref, watchEffect } from 'vue';
import { prefersReducedMotion } from './browser.ts';
import { preferences } from './preferences.ts';
import type { ThemeMode } from './preferences-core.ts';

export type ResolvedTheme = 'latte' | 'mocha';

const darkQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : undefined;
const systemPrefersDark = ref(darkQuery?.matches ?? true);

darkQuery?.addEventListener('change', (event) => {
    systemPrefersDark.value = event.matches;
});

export const resolvedTheme = computed<ResolvedTheme>(() => {
    if (preferences.theme !== 'auto') return preferences.theme;
    return systemPrefersDark.value ? 'mocha' : 'latte';
});

let currentTheme: ResolvedTheme | undefined;
let themeTimer: number | undefined;

export function applyTheme(theme: ResolvedTheme): void {
    const root = document.documentElement;
    const changed = currentTheme !== undefined && currentTheme !== theme;
    currentTheme = theme;
    root.dataset.theme = theme;
    // Keep native form controls, scrollbars and the document color scheme in
    // sync with the selected Catppuccin flavor: Latte is light, Mocha is dark.
    root.style.colorScheme = theme === 'mocha' ? 'dark' : 'light';
    if (!changed || prefersReducedMotion()) return;
    // Briefly opt every surface into a color transition; this avoids animating
    // unrelated layout properties and keeps the first paint instant.
    root.classList.add('theme-transition');
    window.clearTimeout(themeTimer);
    themeTimer = window.setTimeout(() => {
        themeTimer = undefined;
        root.classList.remove('theme-transition');
    }, 300);
}

export function setThemeMode(mode: ThemeMode): void {
    preferences.theme = mode;
}

/** Keeps the DOM theme attribute in sync with preferences and the system theme. */
export function setupTheme(): void {
    applyTheme(resolvedTheme.value);
    watchEffect(() => applyTheme(resolvedTheme.value));
}

export function toggleTheme(): void {
    preferences.theme = resolvedTheme.value === 'mocha' ? 'latte' : 'mocha';
}
