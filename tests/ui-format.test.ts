import test from 'node:test';
import assert from 'node:assert/strict';
import {
    fingerprintGroups,
    formatDateInput,
    formatDateTime,
    formatDuration,
    formatHashes,
    formatPercent,
    formatRate,
    keyId,
    sanitizeFileName,
    shortFingerprint,
} from '../src/ui/format.ts';

const fingerprint = '4A2E117A9F3C00B2D1E4F5A6B7C8D9E0F1A2B3C4';

test('fingerprints are grouped without losing the full value', () => {
    assert.equal(fingerprintGroups(fingerprint), '4A2E 117A 9F3C 00B2 D1E4 F5A6 B7C8 D9E0 F1A2 B3C4');
    assert.equal(shortFingerprint(fingerprint), '4A2E 117A … F1A2 B3C4');
    assert.equal(keyId(fingerprint), 'B7C8 D9E0 F1A2 B3C4');
    assert.equal(fingerprintGroups('abcd'), 'ABCD');
});

test('date helpers keep a stable ISO-like shape in both zones', () => {
    const ms = Date.UTC(2026, 9, 17, 9, 5, 6);
    assert.equal(formatDateTime(ms, 'utc'), '2026-10-17 09:05:06');
    assert.equal(formatDateInput(ms, 'utc'), '2026-10-17');
    assert.equal(formatDateTime(ms, 'local').length, 19);
});

test('durations and hash counts stay readable', () => {
    assert.equal(formatDuration(73), '73 ms');
    assert.equal(formatDuration(1500), '1.50 s');
    assert.equal(formatDuration(65_000), '1m 05s');
    assert.equal(formatDuration(3_900_000), '1h 05m');
    assert.equal(formatHashes(16n), '16');
    assert.equal(formatHashes(65_536n), '65,536');
    assert.equal(formatHashes(4_294_967_296n), '4.29×10⁹');
});

test('hash rates, percentages and file names are sanitized', () => {
    assert.equal(formatRate(1_234_567), '1.2 M hash/s');
    assert.equal(formatRate(2_000_000_000), '2.00 G hash/s');
    assert.equal(formatRate(null), '—');
    assert.equal(formatPercent(0.5), '50.0%');
    assert.equal(formatPercent(1), '>99.99%');
    assert.equal(sanitizeFileName('My Laptop/../:?'), 'My Laptop..');
    assert.equal(sanitizeFileName('   '), 'device');
});
