import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolveSearchWindow, resolveExpiration } from '../src/time-window.ts';

const now = new Date('2026-04-02T12:34:56.789Z');
test('UTC natural day and inclusive expiration date', () => {
    const window = resolveSearchWindow({ mode: 'day', date: '2026-04-01', zone: 'utc' }, now);
    assert.deepEqual(window, { start: Date.parse('2026-04-01T00:00:00Z') / 1000, end: Date.parse('2026-04-01T23:59:59Z') / 1000 });
    assert.equal(resolveExpiration('2026-04-01', 'utc').toISOString(), '2026-04-02T00:00:00.000Z');
});
test('today freezes at the supplied clock and clips future endpoints', () => {
    const window = resolveSearchWindow({ mode: 'today', zone: 'utc' }, now);
    assert.equal(window.end, Math.floor(now.getTime() / 1000));
    assert.equal(window.start, Date.parse('2026-04-02T00:00:00Z') / 1000);
    assert.deepEqual(resolveSearchWindow({ mode: 'range', start: '2026-04-02T00:00:00', end: '2026-04-03T00:00:00', zone: 'utc' }, now), window);
    assert.throws(() => resolveSearchWindow({ mode: 'day', date: '2026-04-03', zone: 'utc' }, now), /empty/);
});
test('strict dates, leap day, and uint32 limits', () => {
    assert.equal(resolveExpiration('2024-02-29', 'utc').toISOString(), '2024-03-01T00:00:00.000Z');
    for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-4-01', '2026-00-01']) {
        assert.throws(() => resolveExpiration(date, 'utc'));
    }
    assert.throws(() => resolveSearchWindow({ mode: 'day', date: '1969-12-31', zone: 'utc' }, now), /uint32/);
    assert.throws(() => resolveExpiration('2107-01-01', 'utc'), /uint32/);
});
test('single-second ranges include epoch zero and enforce the primary lower bound', () => {
    const selection = { mode: 'range' as const, start: '1970-01-01T00:00:00', end: '1970-01-01T00:00:00', zone: 'utc' as const };
    assert.deepEqual(resolveSearchWindow(selection, now), { start: 0, end: 0 });
    assert.throws(() => resolveSearchWindow(selection, now, new Date(1)), /empty/);
    const range = { ...selection, end: '1970-01-01T00:00:10' };
    assert.deepEqual(resolveSearchWindow(range, now, new Date(1001)), { start: 2, end: 10 });
    assert.throws(() => resolveSearchWindow({ ...range, start: '1970-01-01T00:00:11' }, now), /reversed/);
});
test('local natural days honor DST and reject nonexistent local times and skipped days', () => {
    function run(zone: string, code: string): string {
        return execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `import { resolveSearchWindow, resolveExpiration } from './src/time-window.ts'; ${code}`], { env: { ...process.env, TZ: zone }, encoding: 'utf8' }).trim();
    }
    assert.equal(run('America/New_York', `const n=new Date('2027-01-01Z'); console.log(['2026-03-08','2026-11-01'].map(date=>{const w=resolveSearchWindow({mode:'day',date,zone:'local'},n);return w.end-w.start+1}).join(','));`), '82800,90000');
    assert.equal(run('America/New_York', `try { resolveSearchWindow({mode:'range',start:'2026-03-08T02:30:00',end:'2026-03-08T03:30:00',zone:'local'},new Date('2027-01-01Z')); console.log('accepted'); } catch { console.log('rejected'); }`), 'rejected');
    assert.equal(run('Pacific/Apia', `try { resolveExpiration('2011-12-30','local'); console.log('accepted'); } catch { console.log('rejected'); }`), 'rejected');
});
