import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogs, zhCN } from '../src/ui/i18n/messages.ts';
import { detectLocale, translate } from '../src/ui/i18n/translate.ts';
import type { MessageKey } from '../src/ui/i18n/messages.ts';

test('Chinese and English catalogs have identical keys and non-empty values', () => {
    const zhKeys = (Object.keys(zhCN) as MessageKey[]).sort();
    const enKeys = Object.keys(catalogs.en).sort();
    assert.deepEqual(enKeys, zhKeys);
    for (const key of zhKeys) {
        assert.ok(catalogs['zh-CN'][key].trim().length > 0, `missing zh value for ${key}`);
        assert.ok(catalogs.en[key].trim().length > 0, `missing en value for ${key}`);
    }
});

test('placeholders are interpolated and unknown placeholders stay visible', () => {
    assert.equal(translate('zh-CN', 'progress.expected', { hashes: '4.29e9' }), '期望 4.29e9 次 hash');
    assert.equal(translate('en', 'progress.expected', { hashes: '4.29e9' }), '4.29e9 expected hashes');
    assert.equal(translate('en', 'progress.expected', {}), '{hashes} expected hashes');
});

test('locale detection follows the first preferred language', () => {
    assert.equal(detectLocale(['zh-CN', 'en']), 'zh-CN');
    assert.equal(detectLocale(['zh-TW']), 'zh-CN');
    assert.equal(detectLocale(['en-US']), 'en');
    assert.equal(detectLocale([]), 'en');
    assert.equal(detectLocale(undefined), 'en');
});
