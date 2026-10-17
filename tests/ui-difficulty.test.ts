import test from 'node:test';
import assert from 'node:assert/strict';
import {
    difficultyCategory,
    expectedHashes,
    expectedMaterials,
    estimateSeconds,
    hitProbability,
} from '../src/ui/difficulty.ts';

test('expected hash counts follow 16^prefix-length', () => {
    assert.equal(expectedHashes(1), 16n);
    assert.equal(expectedHashes(4), 65_536n);
    assert.equal(expectedHashes(8), 4_294_967_296n);
    assert.equal(expectedHashes(40), 16n ** 40n);
    assert.throws(() => expectedHashes(0));
    assert.throws(() => expectedHashes(41));
    assert.throws(() => expectedHashes(2.5));
});

test('materials scale inversely with the frozen window length', () => {
    assert.equal(expectedMaterials(65_536n, 65_536), 1);
    assert.equal(expectedMaterials(65_536n, 16), 4096);
    assert.equal(expectedMaterials(65_536n, 64_800), 2);
    assert.equal(expectedMaterials(16n, 86_400), 1);
    assert.equal(expectedMaterials(16n, 0), Number.POSITIVE_INFINITY);
});

test('probability is monotonic and bounded', () => {
    const expected = 65_536n;
    assert.equal(hitProbability(expected, 0), 0);
    const half = hitProbability(expected, Number(expected));
    assert.ok(half > 0.6 && half < 0.65);
    assert.ok(hitProbability(expected, Number(expected) * 10) > 0.999);
    assert.equal(hitProbability(0n, 10), 0);
});

test('difficulty categories use the measured rate when available', () => {
    assert.equal(difficultyCategory(16n ** 4n, 1_000_000), 'instant');
    assert.equal(difficultyCategory(16n ** 8n, 50_000_000), 'minutes');
    assert.equal(difficultyCategory(16n ** 10n, 50_000_000), 'hours');
    assert.equal(difficultyCategory(16n ** 11n, 50_000_000), 'days');
    assert.equal(difficultyCategory(16n ** 13n, 50_000_000), 'infeasible');
    // Without a rate, prefix-length bands are used as a rough fallback.
    assert.equal(difficultyCategory(16n ** 4n, null), 'instant');
    assert.equal(difficultyCategory(16n ** 8n, null), 'minutes');
    assert.equal(difficultyCategory(16n ** 12n, null), 'days');
});

test('time estimates are null without a rate', () => {
    assert.equal(estimateSeconds(1_000_000n, null), null);
    assert.equal(estimateSeconds(1_000_000n, 0), null);
    assert.equal(estimateSeconds(1_000_000n, 1_000_000), 1);
});
