import test from 'node:test';
import assert from 'node:assert/strict';
import {
    defaultExpiry,
    defaultTimeWindow,
    describeWindow,
    expiresAtFrom,
    resolveWindow,
    toSelection,
} from '../src/ui/window.ts';

test('datetime-local values without seconds are completed', () => {
    const selection = toSelection({
        mode: 'range',
        date: '',
        rangeStart: '2026-10-17T10:30',
        rangeEnd: '2026-10-17T11:00',
        zone: 'utc',
    });
    assert.deepEqual(selection, {
        mode: 'range',
        start: '2026-10-17T10:30:00',
        end: '2026-10-17T11:00:00',
        zone: 'utc',
    });
});

test('local days and ranges resolve deterministically in UTC', () => {
    const value = {
        mode: 'day' as const,
        date: '2026-10-17',
        rangeStart: '',
        rangeEnd: '',
        zone: 'utc' as const,
    };
    const range = resolveWindow(value, new Date('2026-10-20T00:00:00Z'));
    assert.deepEqual(range, { start: 1_792_195_200, end: 1_792_281_599 });
    assert.equal(range.end - range.start + 1, 86_400);

    assert.throws(() => resolveWindow({
        mode: 'range',
        date: '',
        rangeStart: '2026-10-17T10:00:00',
        rangeEnd: '2026-10-17T09:00:00',
        zone: 'utc',
    }, new Date('2026-10-18T00:00:00Z')));
});

test('window descriptions mention clipping and remain localized', () => {
    const now = new Date('2026-10-17T12:00:00Z');
    const range = { start: 1_792_195_200, end: 1_792_238_400 };
    const en = describeWindow(range, 'utc', now, undefined, 'en');
    assert.match(en, /2026-10-17 00:00:00/);
    assert.match(en, /43201 candidate seconds/);
    assert.match(en, /end clipped to now/);

    const zh = describeWindow(range, 'utc', now, undefined, 'zh-CN');
    assert.match(zh, /个候选秒/);
    assert.match(zh, /结束时刻已裁剪为当前时刻/);
});

test('expiration dates mean the next midnight', () => {
    assert.equal(expiresAtFrom({ mode: 'date', date: '2026-10-17' }, 'utc')?.toISOString(), '2026-10-18T00:00:00.000Z');
    assert.equal(expiresAtFrom({ mode: 'never', date: '' }, 'utc'), null);
    const oneYear = defaultExpiry('utc', 365);
    assert.equal(oneYear.mode, 'date');
    assert.match(oneYear.date, /^\d{4}-\d{2}-\d{2}$/);
    const window = defaultTimeWindow('utc', 'day');
    assert.equal(window.zone, 'utc');
    assert.match(window.date, /^\d{4}-\d{2}-\d{2}$/);
});
