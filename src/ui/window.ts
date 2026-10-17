import { resolveExpiration, resolveSearchWindow } from '../time-window.ts';
import type { SearchWindow, TimeSelection } from '../time-window.ts';
import { formatDateTime, formatDateInput, localTimeZoneName } from './format.ts';
import { translate } from './i18n/translate.ts';
import type { ViewZone } from './preferences-core.ts';
import type { Locale } from './i18n/messages.ts';

export type TimeWindowMode = 'today' | 'day' | 'range';

export type TimeWindowValue = {
    mode: TimeWindowMode;
    date: string;
    rangeStart: string;
    rangeEnd: string;
    zone: ViewZone;
};

export type ExpiryValue = {
    mode: 'never' | 'date';
    date: string;
};

/** Normalize a datetime-local value that omits seconds at exact minutes. */
function normalizeLocalTime(value: string): string {
    return value.length === 16 ? `${value}:00` : value;
}

export function toSelection(value: TimeWindowValue): TimeSelection {
    if (value.mode === 'range') {
        return {
            mode: 'range',
            start: normalizeLocalTime(value.rangeStart),
            end: normalizeLocalTime(value.rangeEnd),
            zone: value.zone,
        };
    }
    return { mode: value.mode, date: value.date, zone: value.zone };
}

export function defaultTimeWindow(zone: ViewZone, mode: TimeWindowMode = 'day'): TimeWindowValue {
    return {
        mode,
        date: formatDateInput(Date.now(), zone),
        rangeStart: '',
        rangeEnd: '',
        zone,
    };
}

export function defaultExpiry(zone: ViewZone, days = 365): ExpiryValue {
    return {
        mode: 'date',
        date: formatDateInput(Date.now() + days * 86_400_000, zone),
    };
}

export function expiresAtFrom(value: ExpiryValue, zone: ViewZone): Date | null {
    if (value.mode === 'never' || !value.date) return null;
    return resolveExpiration(value.date, zone);
}

/** Human-readable frozen-window description with clipping notes. */
export function describeWindow(range: SearchWindow, zone: ViewZone, now: Date, notBefore: Date | undefined, locale: Locale): string {
    const notes: string[] = [];
    if (range.end === Math.floor(now.getTime() / 1000)) {
        notes.push(translate(locale, 'create.window.clippedEnd'));
    }
    if (notBefore && range.start === Math.ceil(notBefore.getTime() / 1000)) {
        notes.push(translate(locale, 'create.window.clippedStart'));
    }
    const suffix = notes.length > 0
        ? locale === 'zh-CN' ? `（${notes.join('；')}）` : ` (${notes.join('; ')})`
        : '';
    return translate(locale, 'create.window.preview', {
        start: formatDateTime(range.start * 1000, zone),
        end: formatDateTime(range.end * 1000, zone),
        zone: zone === 'utc' ? 'UTC' : localTimeZoneName(),
        count: range.end - range.start + 1,
    }) + suffix;
}

export function resolveWindow(value: TimeWindowValue, now: Date, notBefore?: Date): SearchWindow {
    return resolveSearchWindow(toSelection(value), now, notBefore);
}
