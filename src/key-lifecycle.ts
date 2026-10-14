/* Certificate lifecycle operations for a locally managed key.
 *
 * Every operation reads the input certificate exclusively from `KeyDocument.bytes`, rebuilds a fresh
 * packet object graph from those bytes, and publishes the result through `loadKeyDocument`. Existing
 * packets keep their exact framing bytes; only new signature (and new subkey) packets are inserted.
 *
 * Signing always happens on freshly parsed copies, so no verification state cached in an imported
 * `Key` object can skip a check, and no secret material of the input document is ever unlocked or
 * cleared. Material that the operation unlocked itself is cleared again before it settles.
 */
import { enums, SecretKeyPacket, SecretSubkeyPacket, SignaturePacket, UserAttributePacket, UserIDPacket } from 'openpgp';
import type { AnyPacket, Config, RawNotation, UserID } from 'openpgp';
import { fullConfig, rawPacket, signPacket } from './openpgp-packets.ts';
import type { SecretPacket, SignatureData, VanityCandidate } from './openpgp-packets.ts';
import { applyPacketEdits, definiteFrameBytes, encodePackets, findKeyPacketFrame, frameBody, loadKeyDocument, splitKeyBlocks } from './key-document.ts';
import type { KeyBlock, KeyDocument, PacketEdit, PacketFrame } from './key-document.ts';

export type Protection = { passphrase: string; allowUnprotected: boolean };

const maxTimestamp = 0xffffffff;
const saltNotationName = 'salt@notations.openpgpjs.org';

const secretKeyTag = enums.packet.secretKey;
const secretSubkeyTag = enums.packet.secretSubkey;
const userIDTag = enums.packet.userID;
const userAttributeTag = enums.packet.userAttribute;
const signatureTag = enums.packet.signature;

/** Signature types that a user ID block can carry as a self-certification. */
const certificationTypes: readonly enums.signature[] = [
    enums.signature.certGeneric,
    enums.signature.certPersona,
    enums.signature.certCasual,
    enums.signature.certPositive
];

/**
 * Semantic fields of a signature that are copied into a replacement signature.
 * Only fields with a fixed, re-verifiable meaning are listed; cached, issuer, salt and revocation
 * fields are deliberately absent.
 */
type SignatureFields = {
    signatureType: enums.signature;
    keyFlags?: number[];
    preferredSymmetricAlgorithms?: number[];
    preferredHashAlgorithms?: number[];
    preferredCompressionAlgorithms?: number[];
    preferredAEADAlgorithms?: number[];
    preferredCipherSuites?: number[][];
    features?: number[];
    isPrimaryUserID?: boolean;
    keyServerPreferences?: number[];
    preferredKeyServer?: string;
    policyURI?: string;
    exportable?: boolean;
    revocable?: boolean;
    signersUserID?: string;
    rawNotations?: RawNotation[];
    keyExpirationTime?: number;
    keyNeverExpires?: boolean;
    signatureNeverExpires?: boolean;
    embeddedSignature?: SignaturePacket;
};

/**
 * Subset of the parsed signature state whose runtime shape differs from the bundled typings
 * (which declare e.g. `keyFlags` as `Uint8Array` although it is a `number[]`).
 */
type SignatureSemantics = {
    keyFlags: number[] | null;
    keyExpirationTime: number | null;
    keyNeverExpires: boolean | null;
    preferredSymmetricAlgorithms: number[] | null;
    preferredHashAlgorithms: number[] | null;
    preferredCompressionAlgorithms: number[] | null;
    preferredAEADAlgorithms: number[] | null;
    preferredCipherSuites: number[][] | null;
    features: number[] | null;
    isPrimaryUserID: boolean | null;
    keyServerPreferences: number[] | null;
    preferredKeyServer: string | null;
    policyURI: string | null;
    exportable: boolean | null;
    revocable: boolean | null;
    signersUserID: string | null;
    embeddedSignature: SignaturePacket | null;
};

/** The bundled typings omit the `config` argument of `read`. */
interface RuntimeReader {
    read(bytes: Uint8Array, config: Config): Promise<void>;
}

/** The bundled typings omit that `verify` accepts a `null` date for time-independent verification. */
interface RuntimeVerifier {
    verify(key: SecretKeyPacket | SecretSubkeyPacket, signatureType: enums.signature, data: SignatureData, date: Date | null, detached: boolean | undefined, config: Config): Promise<void>;
}

type UserBlock = {
    end: number;
    packet: UserIDPacket | UserAttributePacket;
    signatures: SignaturePacket[];
};

type SubkeyBlock = {
    frame: PacketFrame;
    end: number;
    packet: SecretSubkeyPacket;
    signatures: SignaturePacket[];
};

type Certificate = {
    primary: SecretKeyPacket;
    users: UserBlock[];
    subkeys: SubkeyBlock[];
    signatures: SignaturePacket[];
};

type PreparedSubkey = {
    packet: SecretSubkeyPacket;
    signing: boolean;
    keyExpirationTime: number;
    keyNeverExpires: boolean;
};

type Expiration = { keyExpirationTime: number; keyNeverExpires: boolean };

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function semanticsOf(signature: SignaturePacket): SignatureSemantics {
    return signature as unknown as SignatureSemantics;
}

function signatureProperties(fields: SignatureFields): Partial<SignaturePacket> {
    return fields as unknown as Partial<SignaturePacket>;
}

function toTimestamp(date: Date): number {
    const value = Math.floor(date.getTime() / 1000);
    if (!Number.isFinite(value) || value < 0 || value > maxTimestamp) {
        throw new Error('Time is outside the OpenPGP uint32 timestamp range.');
    }
    return value;
}

/** Resolution order fixed by the plan: a passphrase always encrypts, `null` means explicitly unprotected. */
function resolveProtection(protection: Protection): string | null {
    if (!protection || typeof protection.passphrase !== 'string') throw new Error('Key protection settings are missing.');
    if (protection.passphrase) return protection.passphrase;
    if (protection.allowUnprotected) return null;
    throw new Error('A non-empty passphrase is required unless unprotected private keys are explicitly allowed.');
}

/**
 * Expiration instant to the `keyExpirationTime` subpacket value of a specific key packet.
 * The value is relative to the creation time of the packet it is signed for.
 */
function expirationOf(created: Date, expiresAt: Date | null, now: Date, label: string): Expiration {
    if (expiresAt === null) return { keyExpirationTime: 0, keyNeverExpires: true };
    if (!(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime())) {
        throw new Error(`The expiration of the ${label} must be a valid instant or null for "never".`);
    }
    const target = toTimestamp(expiresAt);
    if (target <= Math.floor(now.getTime() / 1000)) throw new Error(`The expiration of the ${label} must be later than the current time.`);
    const duration = target - toTimestamp(created);
    if (duration <= 0) throw new Error(`The expiration of the ${label} must be later than its creation time.`);
    if (duration > maxTimestamp) throw new Error(`The expiration of the ${label} is too far in the future.`);
    return { keyExpirationTime: duration, keyNeverExpires: false };
}

/** Absolute expiration instant carried by a key-expiration subpacket, or `Infinity`. */
function keyExpirySeconds(created: Date, signature: SignaturePacket): number {
    const semantics = semanticsOf(signature);
    if (semantics.keyNeverExpires === false && typeof semantics.keyExpirationTime === 'number') {
        const expiry = toTimestamp(created) + semantics.keyExpirationTime;
        return expiry > 0 ? expiry : Infinity;
    }
    return Infinity;
}

function copyNotations(source: readonly RawNotation[] | null): RawNotation[] {
    if (!Array.isArray(source)) return [];
    return source
        .filter(notation => notation.name !== saltNotationName)
        .map(notation => ({
            name: notation.name,
            humanReadable: notation.humanReadable,
            critical: notation.critical,
            value: new Uint8Array(notation.value)
        }));
}

function identityOf(userID: UserID): UserIDPacket {
    if (!userID || typeof userID !== 'object') throw new Error('A user ID must be given as an object with a name, comment or email.');
    const identity = UserIDPacket.fromObject(userID);
    if (!identity.userID) throw new Error('A user ID must not be empty.');
    return identity;
}

function normalizeFingerprint(value: string): string {
    const fingerprint = typeof value === 'string' ? value.replace(/\s+/g, '').toLowerCase() : '';
    if (!/^[0-9a-f]{40}$/.test(fingerprint)) throw new Error('A complete v4 fingerprint of 40 hexadecimal characters is required.');
    return fingerprint;
}

/**
 * Drops secret material of a packet this operation unlocked or generated itself.
 * Packets parsed from the input document are never cleared: the document remains the caller's
 * authority, and its secret material must survive our read-only work on a working copy.
 */
function clearUnlockedMaterial(packet: SecretPacket): void {
    if (packet.isDecrypted()) rawPacket(packet).clearPrivateParams();
}

async function readPacket<T extends AnyPacket>(packet: T, body: Uint8Array): Promise<T> {
    await (packet as unknown as RuntimeReader).read(body, fullConfig);
    return packet;
}

async function verifyAt(signature: SignaturePacket, key: SecretKeyPacket | SecretSubkeyPacket, type: enums.signature, data: SignatureData, date: Date | null): Promise<boolean> {
    try {
        await (signature as unknown as RuntimeVerifier).verify(key, type, data, date, undefined, fullConfig);
        return true;
    } catch (error) {
        if (error instanceof Error && /^Unknown critical (signature subpacket|notation)/.test(error.message)) throw error;
        return false;
    }
}

/** Freshest cryptographically valid signature that is not created in the future. */
async function newestValidSignature(signatures: readonly SignaturePacket[], key: SecretKeyPacket | SecretSubkeyPacket, type: enums.signature, data: SignatureData, now: Date): Promise<SignaturePacket | undefined> {
    const limit = Math.floor(now.getTime() / 1000);
    let newest: SignaturePacket | undefined;
    let newestSeconds = -1;
    for (const signature of signatures) {
        if (!signature.created) continue;
        const createdSeconds = Math.floor(signature.created.getTime() / 1000);
        if (createdSeconds > limit || createdSeconds < newestSeconds) continue;
        if (!(await verifyAt(signature, key, type, data, null))) continue;
        newest = signature;
        newestSeconds = createdSeconds;
    }
    return newest;
}

async function readBlockSignatures(bytes: Uint8Array, frames: readonly PacketFrame[]): Promise<SignaturePacket[]> {
    const signatures: SignaturePacket[] = [];
    for (const frame of frames) {
        if (frame.tag !== signatureTag) continue;
        try {
            signatures.push(await readPacket(new SignaturePacket(), frameBody(bytes, frame)));
        } catch {
            // A signature we cannot parse carries no semantics for us; its bytes stay untouched.
        }
    }
    return signatures;
}

function readUserPacket(tag: number, body: Uint8Array): Promise<UserIDPacket | UserAttributePacket> {
    return readPacket(tag === userIDTag ? new UserIDPacket() : new UserAttributePacket(), body);
}

function blockEnd(block: KeyBlock): number {
    let end = block.head.end;
    for (const frame of block.frames) end = Math.max(end, frame.end);
    return end;
}

async function readCertificate(bytes: Uint8Array, document: KeyDocument): Promise<Certificate> {
    let primary: SecretKeyPacket | undefined;
    const users: UserBlock[] = [];
    const subkeys: SubkeyBlock[] = [];
    const signatures: SignaturePacket[] = [];
    for (const block of splitKeyBlocks(document)) {
        const parsed = await readBlockSignatures(bytes, block.frames);
        signatures.push(...parsed);
        const end = blockEnd(block);
        const body = frameBody(bytes, block.head);
        if (block.head.tag === secretKeyTag) {
            if (primary) throw new Error('The certificate contains more than one primary key packet.');
            const packet = new SecretKeyPacket();
            await readPacket(packet, body);
            primary = packet;
        } else if (block.head.tag === secretSubkeyTag) {
            try {
                const packet = new SecretSubkeyPacket();
                await readPacket(packet, body);
                subkeys.push({ frame: block.head, end, packet, signatures: parsed });
            } catch {
                // Unsupported subkey material stays in the framing bytes; it cannot be a renewal target.
            }
        } else if (block.head.tag === userIDTag || block.head.tag === userAttributeTag) {
            users.push({ end, packet: await readUserPacket(block.head.tag, body), signatures: parsed });
        }
        // Public key packets of a mixed certificate, and unknown packets, stay untouched in the bytes.
    }
    if (!primary) throw new Error('The certificate does not contain a secret primary key packet.');
    return { primary, users, subkeys, signatures };
}

/** Copies the layout of a document whose last frame uses the old-format end-of-file length. */
async function definiteDocument(document: KeyDocument): Promise<KeyDocument> {
    const frames = document.frames;
    const last = frames[frames.length - 1];
    if (!last || !last.indeterminate) return document;
    const bytes = applyPacketEdits(document.bytes, [{
        start: last.start,
        end: last.end,
        replacement: definiteFrameBytes(document.bytes, last)
    }]);
    return await loadKeyDocument(bytes);
}

async function protectPacket(packet: SecretPacket, passphrase: string | null): Promise<void> {
    if (passphrase === null) return;
    await packet.encrypt(passphrase, fullConfig);
    rawPacket(packet).clearPrivateParams();
}

async function unlock(packet: SecretPacket, passphrase: string, label: string): Promise<void> {
    if (packet.isDummy()) throw new Error(`The ${label} has no secret material (GNU dummy) and cannot sign.`);
    if (packet.isMissingSecretKeyMaterial()) throw new Error(`The ${label} is protected with an unsupported scheme and cannot be unlocked.`);
    if (typeof passphrase !== 'string' || !passphrase) throw new Error(`A passphrase is required to unlock the ${label}.`);
    try {
        await packet.decrypt(passphrase);
    } catch (error) {
        throw new Error(`Could not unlock the ${label}: ${message(error)}`);
    }
    if (!packet.isDecrypted()) throw new Error(`The ${label} has no secret material to unlock.`);
    try {
        await packet.validate();
    } catch (error) {
        throw new Error(`The secret material of the ${label} is inconsistent: ${message(error)}`);
    }
}

/** Signature instant that is never in the future and never collides with the replaced signature's second. */
async function signatureDate(source: SignaturePacket, now: Date): Promise<Date> {
    const limit = Math.floor(now.getTime() / 1000);
    const sourceSeconds = source.created ? Math.floor(source.created.getTime() / 1000) : -1;
    if (sourceSeconds < limit) return new Date(limit * 1000);
    const target = (sourceSeconds + 1) * 1000;
    if (target > Date.now()) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, target - Date.now());
        await promise;
    }
    return new Date(Math.max(target, Math.floor(Date.now() / 1000) * 1000));
}

function userData(primary: SecretKeyPacket, packet: UserIDPacket | UserAttributePacket): SignatureData {
    return packet instanceof UserIDPacket ? { key: primary, userID: packet } : { key: primary, userAttribute: packet };
}

function selfCertifications(primary: SecretKeyPacket, signatures: readonly SignaturePacket[]): SignaturePacket[] {
    return signatures.filter(signature => signature.signatureType !== null && certificationTypes.includes(signature.signatureType) && signature.issuerKeyID.equals(primary.getKeyID()));
}

function bindingSignatures(primary: SecretKeyPacket, block: SubkeyBlock): SignaturePacket[] {
    return block.signatures.filter(signature => signature.signatureType === enums.signature.subkeyBinding && signature.issuerKeyID.equals(primary.getKeyID()));
}

async function hasValidKeyRevocation(certificate: Certificate): Promise<boolean> {
    for (const signature of certificate.signatures) {
        if (signature.signatureType === enums.signature.keyRevocation && await verifyAt(signature, certificate.primary, enums.signature.keyRevocation, { key: certificate.primary }, null)) {
            return true;
        }
    }
    return false;
}

async function isUserRevoked(primary: SecretKeyPacket, block: UserBlock): Promise<boolean> {
    const data = userData(primary, block.packet);
    for (const signature of block.signatures) {
        if (signature.signatureType === enums.signature.certRevocation && await verifyAt(signature, primary, enums.signature.certRevocation, data, null)) {
            return true;
        }
    }
    return false;
}

async function isSubkeyRevoked(primary: SecretKeyPacket, block: SubkeyBlock): Promise<boolean> {
    const data: SignatureData = { key: primary, bind: block.packet };
    for (const signature of block.signatures) {
        if (signature.signatureType === enums.signature.subkeyRevocation && await verifyAt(signature, primary, enums.signature.subkeyRevocation, data, null)) {
            return true;
        }
    }
    return false;
}

/** A primary key is currently usable when it is unrevoked and a user ID carries a valid self-certification. */
async function primaryIsCurrentlyValid(certificate: Certificate, now: Date): Promise<boolean> {
    if (await hasValidKeyRevocation(certificate)) return false;
    const limit = Math.floor(now.getTime() / 1000);
    for (const block of certificate.users) {
        if (await isUserRevoked(certificate.primary, block)) continue;
        const data = userData(certificate.primary, block.packet);
        const certification = await newestValidSignature(selfCertifications(certificate.primary, block.signatures), certificate.primary, enums.signature.certGeneric, data, now);
        if (!certification || certification.isExpired(now)) continue;
        if (keyExpirySeconds(certificate.primary.created, certification) > limit) return true;
    }
    return false;
}

function passphraseFor(passphrases: Readonly<Record<string, string>> | undefined, fingerprint: string): string | undefined {
    if (!passphrases) return undefined;
    const direct = passphrases[fingerprint] ?? passphrases[fingerprint.toUpperCase()];
    if (direct !== undefined) return direct;
    return Object.entries(passphrases).find(([key]) => key.replace(/\s+/g, '').toLowerCase() === fingerprint)?.[1];
}

async function prepareSubkey(candidate: VanityCandidate, primary: SecretKeyPacket, now: Date, expiresAt: Date | null): Promise<PreparedSubkey> {
    if (!candidate || !candidate.packet) throw new Error('A subkey candidate must carry a secret subkey packet.');
    if (candidate.role !== 'signing' && candidate.role !== 'encryption') throw new Error('Only signing or encryption subkey candidates can be appended.');
    const packet = candidate.packet;
    if (!(packet instanceof SecretSubkeyPacket)) throw new Error('A subkey candidate must carry a secret subkey packet.');
    const signing = candidate.role === 'signing';
    if (packet.version !== 4) throw new Error('Only version 4 subkeys are supported.');
    if (signing ? packet.algorithm !== enums.publicKey.eddsaLegacy : packet.algorithm !== enums.publicKey.ecdh) {
        throw new Error(`A ${candidate.role} subkey must use ${signing ? 'Ed25519 (legacy)' : 'Curve25519 (legacy)'}.`);
    }
    if (typeof candidate.fingerprint !== 'string' || packet.getFingerprint() !== candidate.fingerprint.toLowerCase()) {
        throw new Error('The candidate fingerprint does not match its key packet.');
    }
    if (!packet.isDecrypted()) throw new Error('The subkey candidate is already protected; protection is applied after signing.');
    await packet.validate();
    if (toTimestamp(packet.created) < toTimestamp(primary.created)) throw new Error('A subkey must not be created before its primary key.');
    if (toTimestamp(packet.created) > Math.floor(now.getTime() / 1000)) throw new Error('A subkey must not be created in the future.');
    return { packet, signing, ...expirationOf(packet.created, expiresAt, now, `${candidate.role} subkey`) };
}

async function bindSubkey(item: PreparedSubkey, primary: SecretKeyPacket, now: Date): Promise<SignaturePacket> {
    const data: SignatureData = { key: primary, bind: item.packet };
    const properties: SignatureFields = {
        signatureType: enums.signature.subkeyBinding,
        keyFlags: item.signing ? [enums.keyFlags.signData] : [enums.keyFlags.encryptCommunication | enums.keyFlags.encryptStorage],
        keyExpirationTime: item.keyExpirationTime,
        keyNeverExpires: item.keyNeverExpires,
        signatureNeverExpires: true
    };
    if (item.signing) {
        const embedded: SignatureFields = { signatureType: enums.signature.keyBinding, signatureNeverExpires: true };
        properties.embeddedSignature = await signPacket(item.packet, signatureProperties(embedded), data, now);
    }
    return signPacket(primary, signatureProperties(properties), data, now);
}

function replacementUserFields(source: SignaturePacket, created: Date, expiresAt: Date | null, now: Date): SignatureFields {
    const semantics = semanticsOf(source);
    const fields: SignatureFields = {
        signatureType: source.signatureType ?? enums.signature.certPositive,
        ...expirationOf(created, expiresAt, now, 'primary key'),
        signatureNeverExpires: true
    };
    if (semantics.keyFlags) fields.keyFlags = [...semantics.keyFlags];
    if (semantics.isPrimaryUserID !== null) fields.isPrimaryUserID = semantics.isPrimaryUserID;
    if (semantics.preferredSymmetricAlgorithms) fields.preferredSymmetricAlgorithms = [...semantics.preferredSymmetricAlgorithms];
    if (semantics.preferredHashAlgorithms) fields.preferredHashAlgorithms = [...semantics.preferredHashAlgorithms];
    if (semantics.preferredCompressionAlgorithms) fields.preferredCompressionAlgorithms = [...semantics.preferredCompressionAlgorithms];
    if (semantics.preferredAEADAlgorithms) fields.preferredAEADAlgorithms = [...semantics.preferredAEADAlgorithms];
    if (semantics.preferredCipherSuites) fields.preferredCipherSuites = semantics.preferredCipherSuites.map(suite => [...suite]);
    if (semantics.features) fields.features = [...semantics.features];
    if (semantics.keyServerPreferences) fields.keyServerPreferences = [...semantics.keyServerPreferences];
    if (semantics.preferredKeyServer !== null) fields.preferredKeyServer = semantics.preferredKeyServer;
    if (semantics.policyURI !== null) fields.policyURI = semantics.policyURI;
    if (semantics.exportable !== null) fields.exportable = semantics.exportable;
    if (semantics.revocable !== null) fields.revocable = semantics.revocable;
    if (semantics.signersUserID !== null) fields.signersUserID = semantics.signersUserID;
    const notations = copyNotations(source.rawNotations);
    if (notations.length > 0) fields.rawNotations = notations;
    return fields;
}

function replacementBindingFields(source: SignaturePacket, created: Date, expiresAt: Date | null, now: Date, embedded: SignaturePacket | undefined): SignatureFields {
    const semantics = semanticsOf(source);
    const fields: SignatureFields = {
        signatureType: enums.signature.subkeyBinding,
        ...expirationOf(created, expiresAt, now, 'subkey'),
        signatureNeverExpires: true
    };
    if (semantics.keyFlags) fields.keyFlags = [...semantics.keyFlags];
    if (semantics.policyURI !== null) fields.policyURI = semantics.policyURI;
    if (semantics.revocable !== null) fields.revocable = semantics.revocable;
    const notations = copyNotations(source.rawNotations);
    if (notations.length > 0) fields.rawNotations = notations;
    if (embedded) fields.embeddedSignature = embedded;
    return fields;
}

/**
 * Creates a certificate that contains exactly one certification-capable primary key and one
 * self-certification per user ID. No subkey is added here; that is a separate operation.
 */
export async function createPrimaryDocument(candidate: VanityCandidate, userIDs: readonly UserID[], expiresAt: Date | null, protection: Protection): Promise<KeyDocument> {
    if (!candidate || !candidate.packet) throw new Error('A certificate must start from a primary key candidate.');
    const packet = candidate.packet;
    try {
        if (candidate.role !== 'primary') throw new Error('Only a primary key candidate can start a certificate.');
        if (packet instanceof SecretSubkeyPacket) throw new Error('A primary candidate must carry a secret key packet, not a secret subkey packet.');
        if (packet.version !== 4 || packet.algorithm !== enums.publicKey.eddsaLegacy) throw new Error('Only version 4 Ed25519 (legacy) primary keys are supported.');
        if (packet.getFingerprint() !== candidate.fingerprint.toLowerCase()) throw new Error('The candidate fingerprint does not match its key packet.');
        if (!packet.isDecrypted()) throw new Error('The primary key candidate is already protected; protection is applied after signing.');
        if (!Array.isArray(userIDs) || userIDs.length === 0) throw new Error('At least one user ID is required.');
        const identities = userIDs.map(identityOf);
        const passphrase = resolveProtection(protection);
        const now = new Date();
        if (toTimestamp(packet.created) > Math.floor(now.getTime() / 1000)) throw new Error('A primary key must not be created in the future.');
        await packet.validate();
        const expiry = expirationOf(packet.created, expiresAt, now, 'primary key');
        const packets: AnyPacket[] = [packet];
        for (let index = 0; index < identities.length; index++) {
            const properties: SignatureFields = {
                signatureType: enums.signature.certPositive,
                keyFlags: [enums.keyFlags.certifyKeys],
                preferredSymmetricAlgorithms: [enums.symmetric.aes256, enums.symmetric.aes128],
                preferredHashAlgorithms: [enums.hash.sha512, enums.hash.sha256],
                preferredCompressionAlgorithms: [enums.compression.uncompressed, enums.compression.zlib, enums.compression.zip],
                features: [0x01], // RFC 9580 modification detection; absent from the library's enum typings.
                signatureNeverExpires: true,
                ...expiry
            };
            if (index === 0) properties.isPrimaryUserID = true;
            const identity = identities[index];
            const signature = await signPacket(packet, signatureProperties(properties), { key: packet, userID: identity }, now);
            packets.push(identity, signature);
        }
        await protectPacket(packet, passphrase);
        return await loadKeyDocument(encodePackets(packets));
    } finally {
        clearUnlockedMaterial(packet);
    }
}

/**
 * Appends signing and encryption subkeys with fresh binding signatures to an existing certificate.
 * The primary key must be currently valid; every new binding is signed by the primary key itself.
 */
export async function appendSubkeys(document: KeyDocument, candidates: readonly VanityCandidate[], expiresAt: Date | null, primaryPassphrase: string, protection: Protection): Promise<KeyDocument> {
    if (!Array.isArray(candidates) || candidates.length === 0) throw new Error('At least one subkey candidate is required.');
    const provided = candidates.filter(candidate => typeof candidate?.fingerprint === 'string').map(candidate => candidate.fingerprint.toLowerCase());
    if (new Set(provided).size !== provided.length) throw new Error('The same subkey fingerprint was provided more than once.');
    const passphrase = resolveProtection(protection);
    const now = new Date();
    const base = await definiteDocument(document);
    const certificate = await readCertificate(base.bytes, base);
    const primary = certificate.primary;
    const needsPrimaryUnlock = !primary.isDecrypted();
    try {
        if (!(await primaryIsCurrentlyValid(certificate, now))) {
            throw new Error('The primary key is revoked, expired or lacks a valid self-certification; renew it before adding subkeys.');
        }
        const prepared: PreparedSubkey[] = [];
        for (const candidate of candidates) prepared.push(await prepareSubkey(candidate, primary, now, expiresAt));
        if (needsPrimaryUnlock) await unlock(primary, primaryPassphrase, 'primary key');
        else await primary.validate();
        const packets: AnyPacket[] = [];
        for (const item of prepared) {
            const binding = await bindSubkey(item, primary, now);
            await protectPacket(item.packet, passphrase);
            packets.push(item.packet, binding);
        }
        const bytes = applyPacketEdits(base.bytes, [{
            start: base.bytes.length,
            end: base.bytes.length,
            replacement: encodePackets(packets)
        }]);
        return await loadKeyDocument(bytes);
    } finally {
        clearUnlockedMaterial(primary);
        for (const block of certificate.subkeys) clearUnlockedMaterial(block.packet);
        // Candidates stay owned by this operation: none of them is published before the document is built.
        for (const candidate of candidates) {
            if (candidate.packet instanceof SecretSubkeyPacket) clearUnlockedMaterial(candidate.packet);
        }
    }
}

/**
 * Extends the expiration of the selected primary key and/or subkeys.
 * Only new signatures are added: every existing packet keeps its bytes, its fingerprint and its
 * creation time, and no revoked primary key, subkey or user ID is revived.
 */
export async function renewKey(document: KeyDocument, fingerprints: readonly string[], expiresAt: Date | null, primaryPassphrase: string, subkeyPassphrases?: Readonly<Record<string, string>>): Promise<KeyDocument> {
    if (!Array.isArray(fingerprints) || fingerprints.length === 0) throw new Error('Select at least one complete fingerprint to renew.');
    const requested = fingerprints.map(normalizeFingerprint);
    if (new Set(requested).size !== requested.length) throw new Error('The same fingerprint was selected more than once.');
    const now = new Date();
    const base = await definiteDocument(document);
    const certificate = await readCertificate(base.bytes, base);
    const primary = certificate.primary;
    try {
        if (await hasValidKeyRevocation(certificate)) throw new Error('The primary key is revoked and cannot be renewed.');
        const target = expiresAt === null ? null : toTimestamp(expiresAt);
        if (target !== null && target <= Math.floor(now.getTime() / 1000)) throw new Error('The new expiration must be later than the current time.');
        const primaryFingerprint = primary.getFingerprint();

        const userTargets: { block: UserBlock; source: SignaturePacket }[] = [];
        for (const block of certificate.users) {
            if (await isUserRevoked(primary, block)) continue;
            const data = userData(primary, block.packet);
            const source = await newestValidSignature(selfCertifications(primary, block.signatures), primary, enums.signature.certGeneric, data, now);
            if (source && !source.isExpired(now)) userTargets.push({ block, source });
        }
        if (userTargets.length === 0) throw new Error('The primary key has no currently valid, unrevoked self-certification.');
        const selectedPrimary = requested.includes(primaryFingerprint);
        if (selectedPrimary) {
            requireExtension(Math.max(...userTargets.map(item => keyExpirySeconds(primary.created, item.source))), target, 'primary key');
        }

        const subkeyTargets: { block: SubkeyBlock; source: SignaturePacket; signing: boolean }[] = [];
        for (const fingerprint of requested) {
            if (fingerprint === primaryFingerprint) continue;
            const frame = findKeyPacketFrame(base, fingerprint);
            if (!frame) throw new Error(`The certificate does not contain the key ${fingerprint}.`);
            const block = certificate.subkeys.find(item => item.frame.start === frame.start && item.frame.end === frame.end);
            if (!block) throw new Error(`The subkey ${fingerprint} carries unsupported secret key material and cannot be renewed.`);
            const algorithm = block.packet.algorithm;
            if (algorithm !== enums.publicKey.eddsaLegacy && algorithm !== enums.publicKey.ecdh) {
                throw new Error(`The subkey ${fingerprint} uses an unsupported algorithm and cannot be renewed.`);
            }
            const data: SignatureData = { key: primary, bind: block.packet };
            if (await isSubkeyRevoked(primary, block)) throw new Error(`The subkey ${fingerprint} is revoked and cannot be renewed.`);
            const source = await newestValidSignature(bindingSignatures(primary, block), primary, enums.signature.subkeyBinding, data, now);
            if (!source) throw new Error(`The subkey ${fingerprint} has no valid binding signature to renew.`);
            if (source.isExpired(now)) throw new Error(`The subkey ${fingerprint} binding signature has expired; only key lifetime expiration can be renewed.`);
            requireExtension(keyExpirySeconds(block.packet.created, source), target, `subkey ${fingerprint}`);
            subkeyTargets.push({ block, source, signing: algorithm === enums.publicKey.eddsaLegacy });
        }

        // The primary key always signs the replacement signatures, even when only subkeys are renewed.
        if (!primary.isDecrypted()) await unlock(primary, primaryPassphrase, 'primary key');
        else await primary.validate();
        const edits: PacketEdit[] = [];
        if (selectedPrimary) {
            for (const item of userTargets) {
                const date = await signatureDate(item.source, now);
                const fields = replacementUserFields(item.source, primary.created, expiresAt, now);
                const signature = await signPacket(primary, signatureProperties(fields), userData(primary, item.block.packet), date);
                edits.push({ start: item.block.end, end: item.block.end, replacement: encodePackets([signature]) });
            }
        }
        for (const item of subkeyTargets) {
            const subkey = item.block.packet;
            const fingerprint = subkey.getFingerprint();
            const data: SignatureData = { key: primary, bind: subkey };
            const date = await signatureDate(item.source, now);
            let embedded = item.signing ? semanticsOf(item.source).embeddedSignature ?? undefined : undefined;
            const reusable = embedded !== undefined && !embedded.isExpired(now) && await verifyAt(embedded, subkey, enums.signature.keyBinding, data, null);
            if (item.signing && !reusable) {
                if (!subkey.isDecrypted()) {
                    const passphrase = passphraseFor(subkeyPassphrases, fingerprint);
                    if (!passphrase) throw new Error(`The Signing subkey ${fingerprint} needs a fresh back signature: provide its passphrase.`);
                    await unlock(subkey, passphrase, `signing subkey ${fingerprint}`);
                } else {
                    await subkey.validate();
                }
                const backSignature: SignatureFields = { signatureType: enums.signature.keyBinding, signatureNeverExpires: true };
                embedded = await signPacket(subkey, signatureProperties(backSignature), data, date);
            }
            const fields = replacementBindingFields(item.source, subkey.created, expiresAt, now, embedded);
            const signature = await signPacket(primary, signatureProperties(fields), data, date);
            edits.push({ start: item.block.end, end: item.block.end, replacement: encodePackets([signature]) });
        }
        return await loadKeyDocument(applyPacketEdits(base.bytes, edits));
    } finally {
        clearUnlockedMaterial(primary);
        for (const block of certificate.subkeys) clearUnlockedMaterial(block.packet);
    }
}

/** Renewal must never shorten a lifetime: only a later instant or "never" is accepted. */
function requireExtension(current: number, target: number | null, label: string): void {
    if (target === null) {
        if (current === Infinity) throw new Error(`The ${label} already never expires.`);
        return;
    }
    if (current === Infinity) throw new Error(`The ${label} never expires; choose a finite expiration only by re-creating the key.`);
    if (target <= current) throw new Error(`The new expiration must be later than the current expiration of the ${label}.`);
}
