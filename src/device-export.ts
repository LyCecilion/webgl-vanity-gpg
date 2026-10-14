import { enums, SecretKeyPacket, SecretSubkeyPacket } from 'openpgp';
import { applyPacketEdits, armorKeyDocument, encodePackets, findKeyPacketFrame, loadKeyDocument } from './key-document.ts';
import type { KeyDocument, PacketEdit } from './key-document.ts';
import { fullConfig, rawPacket } from './openpgp-packets.ts';
import type { Protection } from './key-lifecycle.ts';

/** Export a full public identity with secret material limited to explicitly selected subkeys. */
export async function exportDeviceKey(document: KeyDocument, fingerprints: readonly string[], passphrases: Readonly<Record<string, string>>, protection: Protection): Promise<string> {
    if (!Array.isArray(fingerprints) || fingerprints.length === 0) throw new Error('Select at least one subkey for the device.');
    const selected = fingerprints.map(fingerprint => {
        const normalized = fingerprint.replace(/\s+/g, '').toLowerCase();
        if (!/^[0-9a-f]{40}$/.test(normalized)) throw new Error('Select complete subkey fingerprints of 40 hexadecimal characters.');
        return normalized;
    });
    if (new Set(selected).size !== selected.length) throw new Error('The same subkey was selected more than once.');
    if (!protection.passphrase && !protection.allowUnprotected) throw new Error('A device passphrase is required unless unprotected export is explicitly allowed.');
    // Parsing bytes makes all private arrays independent: makeDummy must never touch the source key.
    const copy = await loadKeyDocument(document.bytes);
    const packets = copy.key.getKeys().map(key => key.keyPacket);
    try {
        const primaryFingerprint = copy.key.getFingerprint();
        if (selected.includes(primaryFingerprint)) throw new Error('A device export cannot include primary key secret material.');
        for (const fingerprint of selected) {
            const subkey = copy.key.subkeys.find(key => key.getFingerprint() === fingerprint);
            if (!subkey) throw new Error(`The certificate does not contain subkey ${fingerprint}.`);
            const packet = subkey.keyPacket;
            if (!(packet instanceof SecretSubkeyPacket) || packet.isDummy() || packet.isMissingSecretKeyMaterial()) {
                throw new Error(`Subkey ${fingerprint} has no usable secret material.`);
            }
            try {
                await subkey.verify(new Date(), fullConfig);
            } catch (error) {
                throw new Error(`Subkey ${fingerprint} is revoked, expired or invalid; renew it before device export: ${error instanceof Error ? error.message : String(error)}`);
            }
            if (!rawPacket(packet).isDecrypted()) {
                const passphrase = Object.entries(passphrases).find(([key]) => key.replace(/\s+/g, '').toLowerCase() === fingerprint)?.[1];
                if (!passphrase) throw new Error(`Provide the existing passphrase for subkey ${fingerprint}.`);
                try {
                    await packet.decrypt(passphrase);
                } catch (error) {
                    throw new Error(`Could not unlock subkey ${fingerprint}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            if (!rawPacket(packet).isDecrypted()) throw new Error(`Subkey ${fingerprint} could not be unlocked.`);
            await packet.validate();
        }
        const edits: PacketEdit[] = [];
        for (const key of copy.key.getKeys()) {
            const packet = key.keyPacket;
            if (!(packet instanceof SecretKeyPacket) && !(packet instanceof SecretSubkeyPacket)) throw new Error('The certificate has an unsupported secret packet.');
            const fingerprint = key.getFingerprint();
            const frame = findKeyPacketFrame(copy, fingerprint);
            if (!frame) throw new Error(`Cannot locate the secret packet for ${fingerprint}.`);
            if (!selected.includes(fingerprint)) {
                packet.makeDummy(fullConfig);
            } else if (protection.passphrase) {
                await packet.encrypt(protection.passphrase, fullConfig);
                rawPacket(packet).clearPrivateParams();
            }
            edits.push({ start: frame.start, end: frame.end, replacement: encodePackets([packet]) });
        }
        const secretFrames = copy.frames.filter(frame => frame.tag === enums.packet.secretKey || frame.tag === enums.packet.secretSubkey);
        if (edits.length !== secretFrames.length || new Set(edits.map(edit => edit.start)).size !== secretFrames.length) {
            throw new Error('Not every secret packet could be isolated; unsupported secret packets prevent device export.');
        }
        return armorKeyDocument(await loadKeyDocument(applyPacketEdits(copy.bytes, edits)));
    } finally {
        for (const packet of packets) {
            if ((packet instanceof SecretKeyPacket || packet instanceof SecretSubkeyPacket) && rawPacket(packet).isDecrypted()) rawPacket(packet).clearPrivateParams();
        }
    }
}
