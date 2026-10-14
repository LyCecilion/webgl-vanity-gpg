import { armor, enums, PacketList, readPrivateKey, unarmor } from 'openpgp';
import type { AnyKeyPacket, AnyPacket, PrivateKey, Stream } from 'openpgp';
import { fullConfig, opaquePacket, rawPacket } from './openpgp-packets.ts';

/**
 * Lossless packet framing for private key files.
 *
 * OpenPGP.js reshapes keys while parsing them: it drops packets it does not model (unknown
 * non-critical tags, trust packets) and re-serializes headers, so `key.armor()` is not an
 * acceptable source of output bytes. A `KeyDocument` therefore keeps the exact bytes that were
 * imported, the framing offsets of every packet inside those bytes, and a parsed `PrivateKey`
 * that is used only for semantic validation and signing. Packets that are deliberately added or
 * replaced are re-encoded explicitly; every other packet is copied byte for byte.
 */
export type PacketFrame = {
    /** Packet tag as encoded in the header bit field. */
    tag: number;
    /** Offset of the first header octet inside the document bytes. */
    start: number;
    /** Offset just past the last body octet inside the document bytes. */
    end: number;
    /** True for an old-format packet whose length runs to the end of the input (length type 3). */
    indeterminate: boolean;
};
export type PacketEdit = { start: number; end: number; replacement: Uint8Array };
export type KeyDocument = { bytes: Uint8Array; frames: readonly PacketFrame[]; key: PrivateKey };
/** A key block: the head packet plus the signature and other packets that follow it. */
export type KeyBlock = { head: PacketFrame; frames: readonly PacketFrame[] };

type BodySpan = { start: number; end: number };

const headerBit = 0x80;
const newFormatBit = 0x40;
/** First octet value that encodes a partial body length. */
const partialLengthStart = 224;
/** Octet value that introduces a five-octet body length. */
const fiveOctetLength = 255;

/** Packets that start a new key block; every other packet belongs to the preceding block. */
const keyBlockHeadTags: Record<number, boolean> = {
    [enums.packet.secretKey]: true,
    [enums.packet.publicKey]: true,
    [enums.packet.secretSubkey]: true,
    [enums.packet.publicSubkey]: true,
    [enums.packet.userID]: true,
    [enums.packet.userAttribute]: true,
};

const armorTypeNames: Record<number, string | undefined> = {
    [enums.armor.message]: 'a message block',
    [enums.armor.publicKey]: 'a public key block',
    [enums.armor.signature]: 'a signature block',
    [enums.armor.signed]: 'a cleartext signed message block',
};

type ParsedPacket = { frame: PacketFrame; body: BodySpan[] };

/**
 * Reads one packet header plus its body extent at `start`.
 *
 * Implements the RFC 9580 §4.2 length encodings: old-format one/two/four-octet and
 * indeterminate lengths, new-format one/two/five-octet lengths and partial chains. Partial
 * chains must be terminated by a definite length before the end of the input, and every length
 * is checked against the available bytes so a truncated or overlong packet is rejected instead
 * of being silently clipped. Five-octet lengths are read with a `DataView` so values above
 * 2^31 - 1 do not overflow into negative numbers.
 */
function parsePacket(bytes: Uint8Array, view: DataView, start: number): ParsedPacket {
    if (start >= bytes.length) throw new Error(`Truncated packet at offset ${start}: the header octet is missing.`);
    const header = bytes[start];
    if ((header & headerBit) === 0) throw new Error(`Invalid packet header octet 0x${header.toString(16)} at offset ${start}: bit 7 must be set.`);
    let offset = start + 1;
    if ((header & newFormatBit) !== 0) {
        const tag = header & 0x3f;
        const body: BodySpan[] = [];
        for (;;) {
            if (offset >= bytes.length) throw new Error(`Truncated packet at offset ${offset}: the length octet is missing.`);
            const lengthOctet = bytes[offset];
            offset += 1;
            let length: number;
            let partial = false;
            if (lengthOctet < 192) {
                length = lengthOctet;
            } else if (lengthOctet < partialLengthStart) {
                if (offset >= bytes.length) throw new Error(`Truncated packet at offset ${offset}: the second length octet is missing.`);
                length = ((lengthOctet - 192) << 8) + bytes[offset] + 192;
                offset += 1;
            } else if (lengthOctet < fiveOctetLength) {
                length = 2 ** (lengthOctet & 0x1f);
                partial = true;
            } else {
                if (offset + 4 > bytes.length) throw new Error(`Truncated packet at offset ${offset}: the five-octet length is incomplete.`);
                length = view.getUint32(offset);
                offset += 4;
            }
            if (offset + length > bytes.length) throw new Error(`Packet at offset ${start} claims ${length} body octets but only ${bytes.length - offset} are available.`);
            if (length > 0) body.push({ start: offset, end: offset + length });
            offset += length;
            if (!partial) break;
        }
        return { frame: { tag, start, end: offset, indeterminate: false }, body };
    }
    const tag = (header & 0x3f) >> 2;
    const lengthType = header & 0x03;
    if (lengthType === 3) {
        // Indeterminate length: the body is everything left in the input.
        return { frame: { tag, start, end: bytes.length, indeterminate: true }, body: offset < bytes.length ? [{ start: offset, end: bytes.length }] : [] };
    }
    const lengthOctets = lengthType === 0 ? 1 : lengthType === 1 ? 2 : 4;
    if (offset + lengthOctets > bytes.length) throw new Error(`Truncated packet at offset ${offset}: the length field needs ${lengthOctets} octet(s).`);
    let length = 0;
    for (let index = 0; index < lengthOctets; index++) length = length * 256 + bytes[offset + index];
    offset += lengthOctets;
    if (offset + length > bytes.length) throw new Error(`Packet at offset ${start} claims ${length} body octets but only ${bytes.length - offset} are available.`);
    return { frame: { tag, start, end: offset + length, indeterminate: false }, body: length > 0 ? [{ start: offset, end: offset + length }] : [] };
}

/** Re-parses the packet a frame points at and checks that the frame still describes those bytes. */
function parseFrame(bytes: Uint8Array, frame: PacketFrame): ParsedPacket {
    if (!Number.isInteger(frame.start) || !Number.isInteger(frame.end) || frame.start < 0 || frame.end > bytes.length || frame.start >= frame.end) {
        throw new Error('The packet frame is outside the document bytes.');
    }
    const parsed = parsePacket(bytes, new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), frame.start);
    if (parsed.frame.tag !== frame.tag || parsed.frame.end !== frame.end || parsed.frame.indeterminate !== frame.indeterminate) {
        throw new Error(`The packet frame at offset ${frame.start} does not match the document bytes.`);
    }
    return parsed;
}

function concatBody(bytes: Uint8Array, spans: readonly BodySpan[]): Uint8Array {
    if (spans.length === 0) return new Uint8Array(0);
    if (spans.length === 1) return bytes.slice(spans[0].start, spans[0].end);
    let length = 0;
    for (const span of spans) length += span.end - span.start;
    const body = new Uint8Array(length);
    let offset = 0;
    for (const span of spans) {
        body.set(bytes.subarray(span.start, span.end), offset);
        offset += span.end - span.start;
    }
    return body;
}

function startsWith(container: Uint8Array, prefix: Uint8Array): boolean {
    if (prefix.length > container.length) return false;
    for (let index = 0; index < prefix.length; index++) {
        if (container[index] !== prefix[index]) return false;
    }
    return true;
}

function normalizeFingerprint(fingerprint: string): string {
    return fingerprint.replace(/[\s:]/g, '').toUpperCase();
}

/** Framing of caller-provided bytes is not a contract of the edit helpers, so failures only disable their guard. */
function tryScanPacketFrames(bytes: Uint8Array): PacketFrame[] | undefined {
    try {
        return scanPacketFrames(bytes);
    } catch {
        return undefined;
    }
}

/**
 * An old-format packet with an indeterminate length swallows everything up to the end of the
 * input, so appending packets behind it would bury them inside its body. Reject that instead of
 * producing a file whose appended packets are part of a legacy packet's body.
 */
function rejectIndeterminateAppend(bytes: Uint8Array, result: Uint8Array): void {
    const tail = tryScanPacketFrames(bytes)?.at(-1);
    if (!tail?.indeterminate) return;
    const resultTail = tryScanPacketFrames(result)?.at(-1);
    // A definite re-encoding of the legacy frame ends the guard: its body is now bounded.
    if (!resultTail?.indeterminate) return;
    const before = bytes.subarray(tail.start, tail.end);
    const after = result.subarray(resultTail.start, resultTail.end);
    if (after.length > before.length && startsWith(after, before)) {
        throw new Error('Cannot append packets behind an indeterminate-length packet; rewrite it with definiteFrameBytes first.');
    }
}

/** Scans every packet frame of a binary key block without decoding any packet content. */
export function scanPacketFrames(bytes: Uint8Array): PacketFrame[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const frames: PacketFrame[] = [];
    for (let offset = 0; offset < bytes.length;) {
        const parsed = parsePacket(bytes, view, offset);
        frames.push(parsed.frame);
        offset = parsed.frame.end;
    }
    return frames;
}

/**
 * Returns the body of a frame, i.e. the packet content without its header. Bodies split over a
 * partial-length chain are returned as one contiguous array. The frame is re-checked against the
 * bytes, so a frame from another document is rejected rather than read at the wrong offset.
 */
export function frameBody(bytes: Uint8Array, frame: PacketFrame): Uint8Array {
    return concatBody(bytes, parseFrame(bytes, frame).body);
}

/**
 * Re-encodes one packet with new-format definite framing while keeping its body identical.
 * Only the header changes; this is what makes a legacy indeterminate-length final packet safe to
 * append behind. Frames that already use new-format definite framing are re-encoded unchanged.
 */
export function definiteFrameBytes(bytes: Uint8Array, frame: PacketFrame): Uint8Array {
    return encodePackets([opaquePacket(frame.tag, frameBody(bytes, frame))]);
}

/**
 * Serializes packets with the library writer: a new-format definite-length header followed by the
 * body each packet produces. `PacketList.push` returns the new length, so packets are pushed one
 * by one instead of being passed to a chained call.
 */
export function encodePackets(packets: readonly AnyPacket[]): Uint8Array {
    const list = new PacketList<AnyPacket>();
    for (const packet of packets) list.push(packet);
    return list.write();
}

/**
 * Applies replacements to the framing bytes in one allocation: edits are sorted, must not
 * overlap, and must sit inside the document. Insertions (an edit whose start equals its end) are
 * allowed. The result is always a new array, so a `KeyDocument` can never be modified in place.
 */
export function applyPacketEdits(bytes: Uint8Array, edits: readonly PacketEdit[]): Uint8Array {
    const ordered = [...edits].sort((left, right) => left.start - right.start);
    let cursor = 0;
    let length = bytes.length;
    for (const edit of ordered) {
        if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < cursor || edit.end < edit.start || edit.end > bytes.length) {
            throw new Error('Packet edits must be sorted, non-overlapping, and inside the document bytes.');
        }
        if (!(edit.replacement instanceof Uint8Array)) throw new Error('A packet edit replacement must be a Uint8Array.');
        cursor = edit.end;
        length += edit.replacement.length - (edit.end - edit.start);
    }
    const result = new Uint8Array(length);
    let source = 0;
    let target = 0;
    for (const edit of ordered) {
        result.set(bytes.subarray(source, edit.start), target);
        target += edit.start - source;
        result.set(edit.replacement, target);
        target += edit.replacement.length;
        source = edit.end;
    }
    result.set(bytes.subarray(source), target);
    rejectIndeterminateAppend(bytes, result);
    return result;
}

/**
 * Validates the framing and the primary key header of a binary private key and parses it.
 *
 * The framing is validated here rather than trusted from the library, and the parsed key is only
 * used for semantics: the returned bytes are an independent copy of the input and stay the
 * authority for every later export. Only version 4 Ed25519 legacy primary keys are accepted, and
 * the library parsing step still applies its own malformed-packet, grammar, and unknown critical
 * packet errors.
 */
export async function loadKeyDocument(binary: Uint8Array): Promise<KeyDocument> {
    if (!(binary instanceof Uint8Array) || binary.length === 0) throw new Error('No binary key data was provided.');
    const bytes = binary.slice();
    const frames = scanPacketFrames(bytes);
    const primary = frames[0];
    const secretKeys = frames.filter((frame) => frame.tag === enums.packet.secretKey);
    if (secretKeys.length === 0) throw new Error('The key data contains no secret primary key packet.');
    if (secretKeys.length > 1) throw new Error('The key data contains more than one primary key; import one key at a time.');
    if (primary !== secretKeys[0]) throw new Error('The first packet of a key must be its secret primary key packet.');
    if (frames.some((frame) => frame.tag === enums.packet.publicKey || frame.tag === enums.packet.publicSubkey)) {
        throw new Error('The key data mixes public key packets into a private key.');
    }
    // A version 4 key packet body starts with the version octet, four created octets, and the algorithm octet.
    const header = frameBody(bytes, primary);
    if (header.length < 6) throw new Error('The secret primary key packet is truncated.');
    if (header[0] !== 4) throw new Error(`Unsupported primary key version ${header[0]}; only version 4 keys are supported.`);
    if (header[5] !== enums.publicKey.eddsaLegacy) throw new Error(`Unsupported primary key algorithm ${header[5]}; only Ed25519 legacy (22) is supported.`);
    try {
        return { bytes, frames, key: await readPrivateKey({ binaryKey: bytes, config: fullConfig }) };
    } catch (error) {
        throw new Error(`The key could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Imports one ASCII-armored private key block and keeps its exact unarmored bytes.
 *
 * Rejects empty input, several armored blocks in one text, non-private armor types, key files
 * without a secret primary key or with more than one, and unsupported primary key versions or
 * algorithms. The library does not compare the CRC24 footer of armored input, so framing and
 * packet validation of the unarmored bytes is what this import relies on.
 */
export async function importKeyDocument(armored: string): Promise<KeyDocument> {
    if (typeof armored !== 'string' || armored.trim() === '') throw new Error('No armored private key was provided.');
    const begins = armored.match(/^-----BEGIN [^-]+-----$/gm)?.length ?? 0;
    const ends = armored.match(/^-----END [^-]+-----$/gm)?.length ?? 0;
    if (begins !== 1 || ends !== 1) throw new Error('Import exactly one armored key block.');
    let block: { type: enums.armor; data: Stream<Uint8Array> };
    try {
        block = await unarmor(armored, fullConfig);
    } catch (error) {
        throw new Error(`Not a valid armored OpenPGP block: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (block.type !== enums.armor.privateKey) {
        throw new Error(`Expected an armored private key block but found ${armorTypeNames[block.type] ?? `armor type ${block.type}`}.`);
    }
    return loadKeyDocument(await streamBytes(block.data));
}

/** Armors the complete private key: every packet of the document, secret material included. */
export function armorKeyDocument(document: KeyDocument): string {
    return armor(enums.armor.privateKey, document.bytes, undefined, undefined, undefined, true, fullConfig);
}

/**
 * Armors the public certificate: every secret key packet is replaced by the public packet body
 * the corresponding key packet produces, and every other frame is copied byte for byte. The
 * result is re-scanned so an export that would still carry secret key packets is refused.
 */
export function armorPublicDocument(document: KeyDocument): string {
    const bytes = publicDocumentBytes(document);
    if (scanPacketFrames(bytes).some((frame) => frame.tag === enums.packet.secretKey || frame.tag === enums.packet.secretSubkey)) {
        throw new Error('The public key export still contains secret key packets.');
    }
    return armor(enums.armor.publicKey, bytes, undefined, undefined, undefined, true, fullConfig);
}

/** Locates the frame of a primary key or subkey by its complete fingerprint. */
export function findKeyPacketFrame(document: KeyDocument, fingerprint: string): PacketFrame | undefined {
    const wanted = normalizeFingerprint(fingerprint);
    const primary = document.frames.find((frame) => frame.tag === enums.packet.secretKey);
    if (primary && normalizeFingerprint(document.key.getFingerprint()) === wanted) return primary;
    for (const subkey of document.key.getSubkeys()) {
        if (normalizeFingerprint(subkey.getFingerprint()) !== wanted) continue;
        const body = rawPacket(subkey.keyPacket).writePublicKey();
        return document.frames.find((frame) => frame.tag === enums.packet.secretSubkey && startsWith(frameBody(document.bytes, frame), body));
    }
    return undefined;
}

/**
 * Groups the document into key blocks: each head packet (primary key, subkey, user ID, user
 * attribute) owns the signature and remaining packets that follow it until the next head. This is
 * what lets callers find the current self-signatures of a block and append a new one at its end.
 */
export function splitKeyBlocks(document: KeyDocument): KeyBlock[] {
    const blocks: KeyBlock[] = [];
    let head: PacketFrame | undefined;
    let frames: PacketFrame[] = [];
    for (const frame of document.frames) {
        if (!head || keyBlockHeadTags[frame.tag]) {
            if (head) blocks.push({ head, frames });
            head = frame;
            frames = [frame];
        } else {
            frames.push(frame);
        }
    }
    if (head) blocks.push({ head, frames });
    return blocks;
}

/**
 * Derives the public packet bodies of every key in the document, so secret frames can be matched
 * to the key they belong to instead of relying on packet order. A version 4 secret key packet body
 * starts with the public key body of that key.
 */
function keyPublicBodies(document: KeyDocument): readonly Uint8Array[] {
    const keyPackets: AnyKeyPacket[] = [document.key.keyPacket, ...document.key.getSubkeys().map((subkey) => subkey.keyPacket)];
    return keyPackets.map((keyPacket) => rawPacket(keyPacket).writePublicKey());
}

function publicDocumentBytes(document: KeyDocument): Uint8Array {
    const candidates = keyPublicBodies(document);
    const used = new Set<number>();
    const edits: PacketEdit[] = [];
    for (const frame of document.frames) {
        const publicTag = frame.tag === enums.packet.secretKey ? enums.packet.publicKey : frame.tag === enums.packet.secretSubkey ? enums.packet.publicSubkey : undefined;
        if (publicTag === undefined) continue;
        const body = frameBody(document.bytes, frame);
        const index = candidates.findIndex((candidate, candidateIndex) => !used.has(candidateIndex) && startsWith(body, candidate));
        if (index === -1) {
            throw new Error(`The ${frame.tag === enums.packet.secretKey ? 'primary key' : 'subkey'} at offset ${frame.start} uses an unsupported algorithm and cannot be exported as a public key.`);
        }
        used.add(index);
        edits.push({ start: frame.start, end: frame.end, replacement: encodePackets([opaquePacket(publicTag, candidates[index])]) });
    }
    return applyPacketEdits(document.bytes, edits);
}

interface BytesReader {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
}

interface ReadableBytes {
    getReader(): BytesReader;
}

function isReaderStream(value: unknown): value is ReadableBytes {
    return typeof value === 'object' && value !== null && 'getReader' in value && typeof value.getReader === 'function';
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array> {
    return typeof value === 'object' && value !== null && Symbol.asyncIterator in value;
}

function concatChunks(chunks: readonly Uint8Array[], length: number): Uint8Array {
    if (chunks.length === 1) return chunks[0];
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
    }
    return bytes;
}

/**
 * Reads unarmored data that the library may hand back either as a byte array or as a stream,
 * depending on the input type and runtime.
 */
async function streamBytes(data: unknown): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (data instanceof Uint8Array) {
        chunks.push(data);
        length = data.length;
    } else if (isReaderStream(data)) {
        const reader = data.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value && value.length > 0) {
                chunks.push(value);
                length += value.length;
            }
        }
    } else if (isAsyncIterable(data)) {
        for await (const chunk of data) {
            chunks.push(chunk);
            length += chunk.length;
        }
    } else {
        throw new Error('The armored block does not contain a byte stream.');
    }
    if (length === 0) throw new Error('The armored block contains no packets.');
    return concatChunks(chunks, length);
}
