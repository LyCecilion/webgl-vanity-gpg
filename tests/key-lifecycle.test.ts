import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { enums, readPrivateKey, SecretSubkeyPacket, UserIDPacket } from 'openpgp';
import { generateCandidate, rawPacket, signPacket, opaquePacket, fullConfig } from '../src/openpgp-packets.ts';
import { createPrimaryDocument, appendSubkeys, renewKey } from '../src/key-lifecycle.ts';
import { importKeyDocument, armorKeyDocument, armorPublicDocument, encodePackets, scanPacketFrames, applyPacketEdits } from '../src/key-document.ts';
import { keyring } from './gpg.ts';
import { exportDeviceKey } from '../src/device-export.ts';

const primaryPassword = 'fixture primary passphrase';
const subPassword = 'fixture subkey passphrase';
const protectedPrimary = { passphrase: primaryPassword, allowUnprotected: false };
const protectedSub = { passphrase: subPassword, allowUnprotected: false };
const created = () => new Date(Date.now() - 86400000 * 3);
const expiration = (days: number) => new Date(Math.floor(Date.now() / 1000) * 1000 + days * 86400000);
async function fixture() {
    const primary = await generateCandidate('primary', created());
    const document = await createPrimaryDocument(primary, [{ name: 'Lifecycle fixture', email: 'fixture@example.invalid' }, { name: 'Second identity' }], expiration(30), protectedPrimary);
    const signing = await generateCandidate('signing', new Date(Date.now() - 86400000));
    const encryption = await generateCandidate('encryption', new Date(Date.now() - 86400000));
    const complete = await appendSubkeys(document, [signing, encryption], expiration(20), primaryPassword, protectedSub);
    return { document, complete, signing: signing.fingerprint, encryption: encryption.fingerprint };
}

function preserved(before: Uint8Array, after: Uint8Array) {
    let offset = 0;
    for (const frame of scanPacketFrames(before)) {
        const bytes = before.subarray(frame.start, frame.end);
        const index = Buffer.from(after).indexOf(bytes, offset);
        assert.ok(index >= offset, `original packet ${frame.tag} preserved in order`);
        offset = index + bytes.length;
    }
}

test('C-only raw primary and S/E bindings survive serialization and GnuPG import', async t => {
    const { document, complete, signing, encryption } = await fixture();
    const ring = await keyring(t);
    const imported = ring.gpg(['--import'], armorKeyDocument(complete));
    assert.equal(imported.status, 0, imported.stderr);
    const listing = ring.gpg(['--with-colons', '--with-subkey-fingerprint', '--list-keys']);
    assert.equal(listing.status, 0, listing.stderr);
    const rows = listing.stdout.split('\n').map(row => row.split(':'));
    assert.equal(rows.find(row => row[0] === 'pub')?.[11]?.includes('s'), false);
    assert.ok(rows.find(row => row[0] === 'pub')?.[11]?.includes('c'));
    assert.ok(rows.some(row => row[0] === 'sub' && row[3] === '22' && row[11].includes('s')));
    assert.ok(rows.some(row => row[0] === 'sub' && row[3] === '18' && row[11].includes('e')));
    preserved(document.bytes, complete.bytes);
    const reread = await readPrivateKey({ armoredKey: armorKeyDocument(complete) });
    assert.equal(createHash('sha1').update(rawPacket(reread.keyPacket).writeForHash(4)).digest('hex'), reread.getFingerprint());
    for (const sub of reread.subkeys) {
        const binding = await sub.verify(new Date(), fullConfig);
        if (sub.getFingerprint() === signing) {
            assert.ok(binding.embeddedSignature);
            await binding.embeddedSignature.verify(sub.keyPacket, enums.signature.keyBinding, { key: reread.keyPacket, bind: sub.keyPacket }, new Date(), false, fullConfig);
        }
    }
    const message = await ring.file('message.txt', 'A real cryptographic lifecycle message.\n');
    const signature = await ring.file('message.sig', '');
    const signed = ring.gpg(['--pinentry-mode', 'loopback', '--passphrase-fd', '0', '--local-user', `${signing}!`, '--output', signature, '--yes', '--detach-sign', message], `${subPassword}\n`);
    assert.equal(signed.status, 0, signed.stderr);
    const verified = ring.gpg(['--status-fd', '1', '--verify', signature, message]);
    assert.equal(verified.status, 0, verified.stderr);
    assert.ok(verified.stdout.includes(`VALIDSIG ${signing.toUpperCase()}`));
    const encrypted = await ring.file('message.gpg', '');
    const encryptionResult = ring.gpg(['--trust-model', 'always', '--recipient', `${encryption}!`, '--output', encrypted, '--yes', '--encrypt', message]);
    assert.equal(encryptionResult.status, 0, encryptionResult.stderr);
    const decrypted = ring.gpg(['--pinentry-mode', 'loopback', '--passphrase-fd', '0', '--decrypt', encrypted], `${subPassword}\n`);
    assert.equal(decrypted.status, 0, decrypted.stderr);
    assert.equal(decrypted.stdout, 'A real cryptographic lifecycle message.\n');
});

test('wrong passwords, invalid selections and protection fail atomically', async () => {
    const { document, complete, signing } = await fixture();
    const saved = complete.bytes.slice();
    const candidate = await generateCandidate('signing', new Date(Date.now() - 1000));
    await assert.rejects(appendSubkeys(document, [candidate], expiration(30), 'wrong password', protectedSub));
    await assert.rejects(renewKey(complete, [signing], expiration(40), 'wrong password'));
    await assert.rejects(renewKey(complete, ['0'.repeat(40)], expiration(40), primaryPassword));
    await assert.rejects(renewKey(complete, [signing, signing], expiration(40), primaryPassword));
    await assert.rejects(renewKey(complete, [], expiration(40), primaryPassword));
    await assert.rejects(renewKey(complete, [signing], expiration(1), primaryPassword));
    assert.deepEqual(complete.bytes, saved);
    const primary = await generateCandidate('primary', created());
    await assert.rejects(createPrimaryDocument(primary, [{ name: 'Fixture' }], null, { passphrase: '', allowUnprotected: false }));
    await assert.rejects(importKeyDocument(''));
    await assert.rejects(importKeyDocument(armorPublicDocument(document)));
});

test('renewal retains identity, historical packets and unrelated subkey expiry', async t => {
    const { complete, signing } = await fixture();
    const before = complete.bytes.slice();
    const target = expiration(60);
    const renewed = await renewKey(complete, [complete.key.getFingerprint(), signing], target, primaryPassword);
    preserved(before, renewed.bytes);
    assert.deepEqual(complete.bytes, before);
    assert.deepEqual(renewed.key.getKeys().map(k => [k.getFingerprint(), k.getCreationTime().getTime()]), complete.key.getKeys().map(k => [k.getFingerprint(), k.getCreationTime().getTime()]));
    const untouchedBefore = await complete.key.subkeys[1].getExpirationTime();
    const untouchedAfter = await renewed.key.subkeys[1].getExpirationTime();
    assert.equal(String(untouchedAfter), String(untouchedBefore));
    const ring = await keyring(t);
    assert.equal(ring.gpg(['--import'], armorKeyDocument(renewed)).status, 0);
    const rows = ring.gpg(['--with-colons', '--list-keys']).stdout.split('\n').map(row => row.split(':'));
    assert.equal(Number(rows.find(row => row[0] === 'pub')?.[6]), Math.floor(target.getTime() / 1000));
    assert.equal(Number(rows.find(row => row[0] === 'sub')?.[6]), Math.floor(target.getTime() / 1000));
});

test('framing bounds, partial chains and legacy EOF are handled without signed lengths', () => {
    assert.deepEqual(scanPacketFrames(new Uint8Array([0xcd, 1, 65])), [{ tag: 13, start: 0, end: 3, indeterminate: false }]);
    assert.deepEqual(scanPacketFrames(new Uint8Array([0xcd, 224, 65, 1, 66])), [{ tag: 13, start: 0, end: 5, indeterminate: false }]);
    assert.deepEqual(scanPacketFrames(new Uint8Array([0xb7, 65, 66])), [{ tag: 13, start: 0, end: 3, indeterminate: true }]);
    for (const bytes of [[0], [0xcd], [0xcd, 2, 65], [0xcd, 224, 65], [0xcd, 255, 255, 255, 255, 255], [0xb6, 0, 0]]) assert.throws(() => scanPacketFrames(new Uint8Array(bytes)));
    assert.throws(() => applyPacketEdits(new Uint8Array(5), [{ start: 0, end: 3, replacement: new Uint8Array() }, { start: 2, end: 4, replacement: new Uint8Array() }]));
});

test('third-party certifications, revocations and unknown noncritical packets survive append', async () => {
    const { complete } = await fixture();
    const copy = await readPrivateKey({ binaryKey: complete.bytes });
    await copy.keyPacket.decrypt(primaryPassword);
    const donor = await generateCandidate('primary', created());
    const certification = await signPacket(donor.packet, { signatureType: enums.signature.certPositive }, { key: copy.keyPacket, userID: copy.users[0].userID! }, new Date());
    const revoked = await generateCandidate('signing', new Date(Date.now() - 10000));
    const withRevoked = await appendSubkeys(complete, [revoked], expiration(10), primaryPassword, protectedSub);
    const revocation = await signPacket(copy.keyPacket, { signatureType: enums.signature.subkeyRevocation, reasonForRevocationFlag: enums.reasonForRevocation.keyRetired }, { key: copy.keyPacket, bind: revoked.packet }, new Date());
    const firstUID = withRevoked.frames.find(frame => frame.tag === 13)!;
    const nextBlock = withRevoked.frames.find(frame => frame.start > firstUID.start && [13, 17, 7].includes(frame.tag))!;
    const historicalBytes = applyPacketEdits(withRevoked.bytes, [
        { start: nextBlock.start, end: nextBlock.start, replacement: encodePackets([certification]) },
        { start: withRevoked.bytes.length, end: withRevoked.bytes.length, replacement: encodePackets([revocation, opaquePacket(61, new Uint8Array([1, 2, 3, 4]))]) },
    ]);
    const historical = await importKeyDocument(armorKeyDocument({ ...withRevoked, bytes: historicalBytes }));
    const fresh = await generateCandidate('encryption', new Date(Date.now() - 1000));
    const appended = await appendSubkeys(historical, [fresh], expiration(40), primaryPassword, protectedSub);
    preserved(historical.bytes, appended.bytes);
    assert.deepEqual(appended.key.getKeys().slice(0, historical.key.getKeys().length).map(k => [k.getFingerprint(), k.getCreationTime().getTime()]), historical.key.getKeys().map(k => [k.getFingerprint(), k.getCreationTime().getTime()]));
    await assert.rejects(renewKey(historical, [revoked.fingerprint], expiration(50), primaryPassword));
    rawPacket(copy.keyPacket).clearPrivateParams();
    rawPacket(donor.packet).clearPrivateParams();
});

test('legacy indeterminate final body remains intact when appending definite new packets', async () => {
    const { document } = await fixture();
    const body = new Uint8Array([0, 1, 2, 3]);
    const bytes = new Uint8Array(document.bytes.length + body.length + 1);
    bytes.set(document.bytes);
    bytes[document.bytes.length] = 0xb3; // old-format trust packet, EOF length
    bytes.set(body, document.bytes.length + 1);
    const legacy = await importKeyDocument(armorKeyDocument({ ...document, bytes }));
    const candidate = await generateCandidate('signing', new Date(Date.now() - 1000));
    const appended = await appendSubkeys(legacy, [candidate], expiration(40), primaryPassword, protectedSub);
    assert.equal(appended.key.subkeys.length, 1);
    assert.ok(Buffer.from(appended.bytes).includes(Buffer.from(encodePackets([opaquePacket(12, body)]))));
    assert.deepEqual(legacy.bytes, bytes);
});

test('multiple primaries and unknown critical packets are rejected at import', async () => {
    const { document } = await fixture();
    const joined = new Uint8Array(document.bytes.length * 2);
    joined.set(document.bytes);
    joined.set(document.bytes, document.bytes.length);
    await assert.rejects(importKeyDocument(armorKeyDocument({ ...document, bytes: joined })));
    const critical = applyPacketEdits(document.bytes, [{ start: document.bytes.length, end: document.bytes.length, replacement: encodePackets([opaquePacket(39, new Uint8Array([1]))]) }]);
    await assert.rejects(importKeyDocument(armorKeyDocument({ ...document, bytes: critical })));
});

test('expired primary lifetime can be renewed without reviving a revoked primary', async () => {
    const primary = await generateCandidate('primary', created());
    const uid = UserIDPacket.fromObject({ name: 'Expired lifetime fixture' });
    const certification = await signPacket(primary.packet, {
        signatureType: enums.signature.certPositive,
        keyFlags: new Uint8Array([enums.keyFlags.certifyKeys]),
        keyExpirationTime: 86400,
        keyNeverExpires: false,
    }, { key: primary.packet, userID: uid }, new Date(Date.now() - 86400000 * 2));
    await primary.packet.encrypt(primaryPassword, fullConfig);
    rawPacket(primary.packet).clearPrivateParams();
    const bytes = encodePackets([primary.packet, uid, certification]);
    const placeholder = { bytes, frames: scanPacketFrames(bytes), key: await readPrivateKey({ binaryKey: bytes }) };
    const document = await importKeyDocument(armorKeyDocument(placeholder));
    await assert.rejects(document.key.verifyPrimaryKey());
    const renewed = await renewKey(document, [primary.fingerprint], expiration(30), primaryPassword);
    await renewed.key.verifyPrimaryKey();
    preserved(document.bytes, renewed.bytes);
    const signer = await readPrivateKey({ binaryKey: document.bytes });
    await signer.keyPacket.decrypt(primaryPassword);
    const revocation = await signPacket(signer.keyPacket, { signatureType: enums.signature.keyRevocation }, { key: signer.keyPacket }, new Date());
    const revokedBytes = applyPacketEdits(document.bytes, [{ start: document.bytes.length, end: document.bytes.length, replacement: encodePackets([revocation]) }]);
    const revoked = await importKeyDocument(armorKeyDocument({ ...document, bytes: revokedBytes }));
    await assert.rejects(renewKey(revoked, [primary.fingerprint], expiration(40), primaryPassword));
    rawPacket(signer.keyPacket).clearPrivateParams();
});

test('expired signing backsig requires usable subkey material and its own password', async () => {
    const { document } = await fixture();
    const signer = await readPrivateKey({ binaryKey: document.bytes });
    await signer.keyPacket.decrypt(primaryPassword);
    const candidate = await generateCandidate('signing', new Date(Date.now() - 86400000));
    const data = { key: signer.keyPacket, bind: candidate.packet };
    const backsig = await signPacket(candidate.packet, {
        signatureType: enums.signature.keyBinding,
        signatureExpirationTime: 1,
        signatureNeverExpires: false,
    }, data, new Date(Date.now() - 10000));
    const binding = await signPacket(signer.keyPacket, {
        signatureType: enums.signature.subkeyBinding,
        keyFlags: new Uint8Array([enums.keyFlags.signData]),
        keyExpirationTime: 86400 * 20,
        keyNeverExpires: false,
        embeddedSignature: backsig,
    }, data, new Date(Date.now() - 5000));
    await candidate.packet.encrypt(subPassword, fullConfig);
    rawPacket(candidate.packet).clearPrivateParams();
    const bytes = applyPacketEdits(document.bytes, [{ start: document.bytes.length, end: document.bytes.length, replacement: encodePackets([candidate.packet, binding]) }]);
    const expiredBacksig = await importKeyDocument(armorKeyDocument({ ...document, bytes }));
    await assert.rejects(renewKey(expiredBacksig, [candidate.fingerprint], expiration(40), primaryPassword));
    const renewed = await renewKey(expiredBacksig, [candidate.fingerprint], expiration(40), primaryPassword, { [candidate.fingerprint]: subPassword });
    const verified = await renewed.key.subkeys[0].verify(new Date(), fullConfig);
    assert.ok(verified.embeddedSignature);
    await verified.embeddedSignature.verify(renewed.key.subkeys[0].keyPacket, enums.signature.keyBinding, { key: renewed.key.keyPacket, bind: renewed.key.subkeys[0].keyPacket }, new Date(), false, fullConfig);
    const dummy = await readPrivateKey({ binaryKey: bytes });
    const packet = dummy.subkeys[0].keyPacket;
    assert.ok(packet instanceof SecretSubkeyPacket);
    packet.makeDummy(fullConfig);
    const frame = expiredBacksig.frames.find(frame => frame.tag === 7)!;
    const missingBytes = applyPacketEdits(bytes, [{ start: frame.start, end: frame.end, replacement: encodePackets([packet]) }]);
    const missing = await importKeyDocument(armorKeyDocument({ ...document, bytes: missingBytes }));
    await assert.rejects(renewKey(missing, [candidate.fingerprint], expiration(40), primaryPassword, { [candidate.fingerprint]: subPassword }));
    assert.deepEqual(expiredBacksig.bytes, bytes);
    rawPacket(signer.keyPacket).clearPrivateParams();
});

test('explicit unprotected export retains usable secrets while nonempty protection always encrypts', async () => {
    const candidate = await generateCandidate('primary', created());
    const unprotected = await createPrimaryDocument(candidate, [{ name: 'Explicit unprotected fixture' }], null, { passphrase: '', allowUnprotected: true });
    assert.equal(rawPacket(unprotected.key.keyPacket).isDecrypted(), true);
    await unprotected.key.keyPacket.validate();
    const protectedCandidate = await generateCandidate('primary', created());
    const protectedDocument = await createPrimaryDocument(protectedCandidate, [{ name: 'Protected precedence fixture' }], null, { passphrase: primaryPassword, allowUnprotected: true });
    assert.equal(rawPacket(protectedDocument.key.keyPacket).isDecrypted(), false);
    const reread = await readPrivateKey({ binaryKey: protectedDocument.bytes });
    await assert.rejects(reread.keyPacket.decrypt(''));
    await reread.keyPacket.decrypt(primaryPassword);
    await reread.keyPacket.validate();
    rawPacket(reread.keyPacket).clearPrivateParams();
});

test('future self-signatures cannot win renewal and unknown critical metadata fails closed', async () => {
    const { document } = await fixture();
    const copy = await readPrivateKey({ binaryKey: document.bytes });
    await copy.keyPacket.decrypt(primaryPassword);
    const data = { key: copy.keyPacket, userID: copy.users[0].userID! };
    const future = await signPacket(copy.keyPacket, { signatureType: enums.signature.certPositive, keyNeverExpires: true }, data, new Date(Date.now() + 86400000));
    const firstBlockEnd = document.frames.find(frame => frame.tag === 13 && frame.start > document.frames.find(f => f.tag === 13)!.start)!.start;
    const futureBytes = applyPacketEdits(document.bytes, [{ start: firstBlockEnd, end: firstBlockEnd, replacement: encodePackets([future]) }]);
    const futureDocument = await importKeyDocument(armorKeyDocument({ ...document, bytes: futureBytes }));
    const renewed = await renewKey(futureDocument, [copy.getFingerprint()], expiration(40), primaryPassword);
    preserved(futureDocument.bytes, renewed.bytes);
    const critical = await signPacket(copy.keyPacket, {
        signatureType: enums.signature.certPositive,
        keyExpirationTime: 86400 * 30,
        keyNeverExpires: false,
        rawNotations: [{ name: 'unrecognized@example.invalid', value: new Uint8Array([1]), humanReadable: false, critical: true }],
    }, data, new Date());
    const criticalBytes = applyPacketEdits(document.bytes, [{ start: firstBlockEnd, end: firstBlockEnd, replacement: encodePackets([critical]) }]);
    const criticalDocument = await importKeyDocument(armorKeyDocument({ ...document, bytes: criticalBytes }));
    await assert.rejects(renewKey(criticalDocument, [copy.getFingerprint()], expiration(40), primaryPassword), /Unknown critical/);
    assert.deepEqual(criticalDocument.bytes, criticalBytes);
    rawPacket(copy.keyPacket).clearPrivateParams();
});

test('device export isolates actual secret files and supports only selected S/E in GnuPG', async t => {
    const { complete, signing, encryption } = await fixture();
    const extra = await generateCandidate('signing', new Date(Date.now() - 1000));
    const document = await appendSubkeys(complete, [extra], expiration(20), primaryPassword, protectedSub);
    const saved = document.bytes.slice();
    const devicePassword = 'separate device passphrase';
    const deviceArmor = await exportDeviceKey(document, [signing, encryption], { [signing]: subPassword, [encryption]: subPassword }, { passphrase: devicePassword, allowUnprotected: false });
    assert.deepEqual(document.bytes, saved);
    const deviceDocument = await importKeyDocument(deviceArmor);
    assert.deepEqual(deviceDocument.key.getKeys().map(k => k.getFingerprint()), document.key.getKeys().map(k => k.getFingerprint()));
    assert.equal(deviceDocument.key.keyPacket.isDummy(), true);
    for (const subkey of deviceDocument.key.subkeys) {
        assert.equal(subkey.keyPacket.isDummy(), ![signing, encryption].includes(subkey.getFingerprint()));
        assert.equal(rawPacket(subkey.keyPacket).isDecrypted(), false);
    }
    const beforeNonSecrets = document.frames.filter(f => f.tag !== 5 && f.tag !== 7).map(f => Buffer.from(document.bytes.subarray(f.start, f.end)));
    const afterNonSecrets = deviceDocument.frames.filter(f => f.tag !== 5 && f.tag !== 7).map(f => Buffer.from(deviceDocument.bytes.subarray(f.start, f.end)));
    assert.deepEqual(afterNonSecrets, beforeNonSecrets);
    const device = await keyring(t);
    const publicRing = await keyring(t);
    assert.equal(device.gpg(['--import'], deviceArmor).status, 0);
    assert.equal(publicRing.gpg(['--import'], armorPublicDocument(document)).status, 0);
    const packetPath = await device.file('device.asc', deviceArmor);
    assert.ok(device.gpg(['--list-packets', packetPath]).stdout.includes('gnu-dummy'));
    const listing = device.gpg(['--with-colons', '--with-keygrip', '--with-subkey-fingerprint', '--list-keys']);
    const grips: Record<string, string> = {};
    let fingerprint = '';
    for (const row of listing.stdout.split('\n').map(line => line.split(':'))) {
        if (row[0] === 'fpr') fingerprint = row[9].toLowerCase();
        if (row[0] === 'grp') grips[fingerprint] = row[9];
    }
    const files = await readdir(join(device.home, 'private-keys-v1.d'));
    assert.deepEqual(files.sort(), [signing, encryption].map(fp => `${grips[fp]}.key`).sort());
    const message = 'Only the selected device subkeys can use this message.\n';
    const messagePath = await device.file('message.txt', message);
    const signaturePath = await device.file('message.sig', '');
    const wrong = device.gpg(['--pinentry-mode', 'loopback', '--passphrase-fd', '0', '--local-user', `${signing}!`, '--output', signaturePath, '--yes', '--detach-sign', messagePath], 'wrong device password\n');
    assert.notEqual(wrong.status, 0, 'wrong password must fail before the agent caches any key');
    const primaryAttempt = device.gpg(['--pinentry-mode', 'loopback', '--passphrase-fd', '0', '--local-user', `${document.key.getFingerprint()}!`, '--output', signaturePath, '--yes', '--detach-sign', messagePath], `${devicePassword}\n`);
    assert.notEqual(primaryAttempt.status, 0);
    const unselectedAttempt = device.gpg(['--pinentry-mode', 'loopback', '--passphrase-fd', '0', '--local-user', `${extra.fingerprint}!`, '--output', signaturePath, '--yes', '--detach-sign', messagePath], `${devicePassword}\n`);
    assert.notEqual(unselectedAttempt.status, 0);
    const signed = device.gpg(['--pinentry-mode', 'loopback', '--passphrase-fd', '0', '--local-user', `${signing}!`, '--output', signaturePath, '--yes', '--detach-sign', messagePath], `${devicePassword}\n`);
    assert.equal(signed.status, 0, signed.stderr);
    const verified = publicRing.gpg(['--status-fd', '1', '--verify', signaturePath, messagePath]);
    assert.equal(verified.status, 0, verified.stderr);
    assert.ok(verified.stdout.includes(`VALIDSIG ${signing.toUpperCase()}`));
    const encryptedPath = await publicRing.file('message.gpg', '');
    const plaintext = await publicRing.file('message.txt', message);
    const encrypted = publicRing.gpg(['--trust-model', 'always', '--recipient', `${encryption}!`, '--output', encryptedPath, '--yes', '--encrypt', plaintext]);
    assert.equal(encrypted.status, 0, encrypted.stderr);
    const decrypted = device.gpg(['--pinentry-mode', 'loopback', '--passphrase-fd', '0', '--decrypt', encryptedPath], `${devicePassword}\n`);
    assert.equal(decrypted.status, 0, decrypted.stderr);
    assert.equal(decrypted.stdout, message);
});

test('invalid device selections and missing/wrong secrets fail without mutating the certificate', async () => {
    const { complete, signing, encryption } = await fixture();
    const before = complete.bytes.slice();
    const passphrases = { [signing]: subPassword, [encryption]: subPassword };
    for (const selection of [[], [complete.key.getFingerprint()], [signing, signing], ['0'.repeat(40)]]) {
        await assert.rejects(exportDeviceKey(complete, selection, passphrases, protectedSub));
    }
    await assert.rejects(exportDeviceKey(complete, [signing], {}, protectedSub));
    await assert.rejects(exportDeviceKey(complete, [signing], { [signing]: 'wrong password' }, protectedSub));
    await assert.rejects(exportDeviceKey(complete, [signing], passphrases, { passphrase: '', allowUnprotected: false }));
    const device = await importKeyDocument(await exportDeviceKey(complete, [signing], passphrases, protectedSub));
    await assert.rejects(exportDeviceKey(device, [encryption], passphrases, protectedSub));
    assert.deepEqual(complete.bytes, before);
    const unprotected = await importKeyDocument(await exportDeviceKey(complete, [signing], passphrases, { passphrase: '', allowUnprotected: true }));
    assert.equal(rawPacket(unprotected.key.subkeys[0].keyPacket).isDecrypted(), true);
    await unprotected.key.subkeys[0].keyPacket.validate();
});

test('new device exports refuse expired and revoked subkeys', async () => {
    const { document, complete, signing } = await fixture();
    const signer = await readPrivateKey({ binaryKey: document.bytes });
    await signer.keyPacket.decrypt(primaryPassword);
    const expiredCandidate = await generateCandidate('encryption', new Date(signer.getCreationTime().getTime() + 1000));
    const binding = await signPacket(signer.keyPacket, {
        signatureType: enums.signature.subkeyBinding,
        keyFlags: new Uint8Array([enums.keyFlags.encryptCommunication | enums.keyFlags.encryptStorage]),
        keyExpirationTime: 1,
        keyNeverExpires: false,
    }, { key: signer.keyPacket, bind: expiredCandidate.packet }, new Date());
    await expiredCandidate.packet.encrypt(subPassword, fullConfig);
    rawPacket(expiredCandidate.packet).clearPrivateParams();
    const expiredBytes = applyPacketEdits(document.bytes, [{ start: document.bytes.length, end: document.bytes.length, replacement: encodePackets([expiredCandidate.packet, binding]) }]);
    const expired = await importKeyDocument(armorKeyDocument({ ...document, bytes: expiredBytes }));
    await assert.rejects(exportDeviceKey(expired, [expiredCandidate.fingerprint], { [expiredCandidate.fingerprint]: subPassword }, protectedSub), /expired/);
    const revokedSubkey = complete.key.subkeys.find(key => key.getFingerprint() === signing)!;
    const revocation = await signPacket(signer.keyPacket, { signatureType: enums.signature.subkeyRevocation }, { key: signer.keyPacket, bind: revokedSubkey.keyPacket }, new Date());
    const nextSubkey = complete.frames.filter(f => f.tag === 7)[1];
    const revokedBytes = applyPacketEdits(complete.bytes, [{ start: nextSubkey.start, end: nextSubkey.start, replacement: encodePackets([revocation]) }]);
    const revoked = await importKeyDocument(armorKeyDocument({ ...complete, bytes: revokedBytes }));
    await assert.rejects(exportDeviceKey(revoked, [signing], { [signing]: subPassword }, protectedSub), /revoked/);
    assert.deepEqual(expired.bytes, expiredBytes);
    assert.deepEqual(revoked.bytes, revokedBytes);
    rawPacket(signer.keyPacket).clearPrivateParams();
});
