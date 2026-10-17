import type { ViewZone } from './preferences-core.ts';

const stampFormatter = new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
});

const utcStampFormatter = new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
});

function formatter(zone: ViewZone): Intl.DateTimeFormat {
    return zone === 'utc' ? utcStampFormatter : stampFormatter;
}

/** `YYYY-MM-DD HH:mm:ss` in the requested zone. */
export function formatDateTime(ms: number, zone: ViewZone): string {
    return formatter(zone).format(ms);
}

/** `YYYY-MM-DD` in the requested zone, suitable for `<input type="date">`. */
export function formatDateInput(ms: number, zone: ViewZone): string {
    return formatDateTime(ms, zone).slice(0, 10);
}

export function formatDate(ms: number, zone: ViewZone): string {
    return formatDateInput(ms, zone);
}

export function localTimeZoneName(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
}

/** `2026-10-17 17:22:25（Asia/Shanghai）` style description of a zone. */
export function zoneName(zone: ViewZone): string {
    return zone === 'utc' ? 'UTC' : localTimeZoneName();
}

export function normalizeFingerprint(fingerprint: string): string {
    return fingerprint.replace(/\s+/g, '').toUpperCase();
}

export function fingerprintGroups(fingerprint: string): string {
    return normalizeFingerprint(fingerprint).match(/.{1,4}/g)?.join(' ') ?? fingerprint;
}

/** First and last two fingerprint groups, e.g. `4A2E 117A … C9F0 1234`. */
export function shortFingerprint(fingerprint: string): string {
    const groups = normalizeFingerprint(fingerprint).match(/.{1,4}/g) ?? [];
    if (groups.length <= 4) return groups.join(' ');
    return `${groups[0]} ${groups[1]} … ${groups[groups.length - 2]} ${groups[groups.length - 1]}`;
}

export function keyId(fingerprint: string): string {
    const normalized = normalizeFingerprint(fingerprint);
    return normalized.slice(-16).match(/.{1,4}/g)?.join(' ') ?? normalized;
}

export function formatNumber(value: number, locale: string): string {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

export function formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return '—';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`;
    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds % 60);
    if (minutes < 60) return `${minutes}m ${String(rest).padStart(2, '0')}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** Compact scientific notation for potentially enormous expected hash counts. */
export function formatHashes(value: bigint | number): string {
    const numeric = typeof value === 'bigint' ? Number(value) : value;
    if (!Number.isFinite(numeric)) return '∞';
    if (numeric < 1_000_000) return Math.round(numeric).toLocaleString('en-US');
    if (numeric < 1e15) return `${(numeric / 1e9).toPrecision(3).replace(/\.?0+$/, '')}e9`.replace('e9', '×10⁹');
    return numeric.toExponential(2).replace('e+', '×10^');
}

export function formatRate(rate: number | null): string {
    if (!rate || !Number.isFinite(rate) || rate <= 0) return '—';
    if (rate >= 1e9) return `${(rate / 1e9).toFixed(2)} G hash/s`;
    if (rate >= 1e6) return `${(rate / 1e6).toFixed(1)} M hash/s`;
    if (rate >= 1e3) return `${(rate / 1e3).toFixed(1)} K hash/s`;
    return `${Math.round(rate)} hash/s`;
}

export function formatPercent(ratio: number): string {
    if (!Number.isFinite(ratio)) return '—';
    const percent = Math.max(0, Math.min(1, ratio)) * 100;
    if (percent >= 99.99) return '>99.99%';
    return `${percent.toFixed(percent < 10 ? 2 : 1)}%`;
}

/** Sanitize a user-supplied device name for use inside a download file name. */
export function sanitizeFileName(value: string): string {
    const cleaned = value.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '').trim();
    return cleaned || 'device';
}

export function byteLength(text: string): number {
    return new TextEncoder().encode(text).byteLength;
}
