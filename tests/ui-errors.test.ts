import test from 'node:test';
import assert from 'node:assert/strict';
import { friendlyError, UiError, uiError } from '../src/ui/errors.ts';

test('UiError messages are translated and keep parameters', () => {
    const error = uiError('add.review.materials', { materials: '4096' });
    assert.ok(error instanceof UiError);
    assert.deepEqual(friendlyError(error, 'zh-CN'), { message: '预计需要约 4096 份密钥材料' });
    assert.deepEqual(friendlyError(error, 'en'), { message: 'About 4096 key materials needed' });
});

test('known engine failures are mapped to localized copy with technical detail', () => {
    const wrong = friendlyError(new Error('Could not unlock subkey AAAA: wrong passphrase'), 'en');
    assert.equal(wrong.message, 'Wrong passphrase, or this key cannot be unlocked.');
    assert.match(wrong.detail ?? '', /Could not unlock/);

    const revoked = friendlyError(new Error('The target key is revoked and cannot be renewed.'), 'zh-CN');
    assert.equal(revoked.message, '目标密钥已被撤销。');

    const webgl = friendlyError(new Error('WebGL shader compilation failed: nope'), 'en');
    assert.equal(webgl.message, 'WebGL initialization or verification failed; no key was issued.');
});

test('unknown errors fall back to a generic message and expose the raw detail', () => {
    const unknown = friendlyError(new Error('something unusual'), 'en');
    assert.equal(unknown.message, 'The operation failed.');
    assert.equal(unknown.detail, 'something unusual');
    const nonError = friendlyError('plain text failure', 'zh-CN');
    assert.equal(nonError.detail, 'plain text failure');
});
