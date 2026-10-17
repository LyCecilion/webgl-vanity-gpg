import { computed, ref, watchEffect } from 'vue';
import { preferences } from './preferences.ts';
import type { ThemeMode } from './preferences-core.ts';

export type ResolvedTheme = 'macchiato' | 'mocha';

const darkQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : undefined;
const systemPrefersDark = ref(darkQuery?.matches ?? true);

darkQuery?.addEventListener('change', (event) => {
    systemPrefersDark.value = event.matches;
});

export const resolvedTheme = computed<ResolvedTheme>(() => {
    if (preferences.theme !== 'auto') return preferences.theme;
    return systemPrefersDark.value ? 'mocha' : 'macchiato';
});

export function applyTheme(theme: ResolvedTheme): void {
    document.documentElement.dataset.theme = theme;
    // Both Catppuccin flavors are dark; declaring the color scheme keeps form
    // controls and scrollbars consistent with the palette.
    document.documentElement.style.colorScheme = 'dark';
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
    preferences.theme = resolvedTheme.value === 'mocha' ? 'macchiato' : 'mocha';
}
