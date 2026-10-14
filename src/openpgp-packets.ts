import { config, enums, SecretKeyPacket, SecretSubkeyPacket, SignaturePacket, UnparseablePacket } from 'openpgp';
import type { AnyKeyPacket, Config, UserIDPacket, UserAttributePacket } from 'openpgp';

export const fullConfig: Config = { ...config, v6Keys: false, aeadProtect: false };
export type KeyRole = 'primary' | 'signing' | 'encryption';
export type SecretPacket = SecretKeyPacket | SecretSubkeyPacket;
export type VanityCandidate = { role: KeyRole; packet: SecretPacket; fingerprint: string };
export type SignatureData = { key: AnyKeyPacket; bind?: AnyKeyPacket; userID?: UserIDPacket; userAttribute?: UserAttributePacket };

export interface RawPacketMethods {
    generate(bits: undefined, curve: enums.curve): Promise<void>;
    computeFingerprintAndKeyID(): Promise<void>;
    writePublicKey(): Uint8Array;
    writeForHash(version: number): Uint8Array;
    clearPrivateParams(): void;
    isDecrypted(): boolean;
}
export function rawPacket(packet: AnyKeyPacket): RawPacketMethods {
    return packet as unknown as RawPacketMethods;
}

export async function generateCandidate(role: KeyRole, created: Date): Promise<VanityCandidate> {
    const Constructor = (role === 'primary' ? SecretKeyPacket : SecretSubkeyPacket) as unknown as new (date: Date, config: Config) => SecretPacket;
    const packet = new Constructor(created, fullConfig);
    packet.algorithm = role === 'encryption' ? enums.publicKey.ecdh : enums.publicKey.eddsaLegacy;
    try {
        await rawPacket(packet).generate(undefined, role === 'encryption' ? enums.curve.curve25519Legacy : enums.curve.ed25519Legacy);
        await rawPacket(packet).computeFingerprintAndKeyID();
        return { role, packet, fingerprint: packet.getFingerprint() };
    } catch (error) {
        if (packet.privateParams) rawPacket(packet).clearPrivateParams();
        throw error;
    }
}

export async function signPacket(signer: SecretPacket, properties: Partial<SignaturePacket>, data: SignatureData, date: Date): Promise<SignaturePacket> {
    const signature = new SignaturePacket();
    Object.assign(signature, properties);
    signature.publicKeyAlgorithm = signer.algorithm;
    signature.hashAlgorithm = enums.hash.sha512;
    const runtime = signature as unknown as { sign(key: SecretPacket, data: SignatureData, date: Date, detached: boolean, config: Config): Promise<void> };
    await runtime.sign(signer, data, date, false, fullConfig);
    return signature;
}

export function opaquePacket(tag: number, body: Uint8Array): UnparseablePacket {
    const Constructor = UnparseablePacket as unknown as new (tag: number, body: Uint8Array) => UnparseablePacket;
    return new Constructor(tag, body);
}
