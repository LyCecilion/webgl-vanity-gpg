import { generateCandidate, rawPacket } from './openpgp-packets.ts';
import type { KeyRole, SecretPacket, VanityCandidate } from './openpgp-packets.ts';
import type { SearchWindow } from './time-window.ts';

import vshaderString from './vshader.glsl?raw';
import fshaderString from './fshader.glsl?raw';

// SHA-1 test vectors and intermediate values:
// https://csrc.nist.gov/CSRC/media/Projects/Cryptographic-Standards-and-Guidelines/documents/examples/SHA1.pdf
// The GPU hashes the v4 key packet exactly like the OpenPGP.js fingerprint code:
// 0x99, the two byte public packet length, then the public packet body. The
// creation time is the second uint32 word of that input, so one material covers
// every timestamp in the window and the secret material never leaves JS memory.

export type SearchProgress = {
    hashes: number;
    materials: number;
    elapsedMs: number;
};

export type VanitySearchOptions = {
    role: KeyRole;
    prefix: string;
    window: SearchWindow;
    threads: number;
    iterations: number;
    signal: AbortSignal;
    onProgress?: (progress: SearchProgress) => void;
};

// A v4 key packet hash input is padded to 64 byte SHA-1 chunks; 128 bytes cover
// both ed25519 (64) and curve25519 (128) candidates of the supported roles.
const MAX_PADDED_HASH_BYTES = 128;
// 40 hex characters = 20 fingerprint bytes = five uint32 words.
const PREFIX_WORDS = 5;
const YIELD_INTERVAL_MS = 16;

const swap32 = (x: number) => (
    ((x &   0xFF) << 24) |
    ((x & 0xFF00) <<  8) |
    ((x >>  8) & 0xFF00) |
    ((x >> 24) &   0xFF)
) >>> 0;

type PrefixMask = {
    wordCount: number;
    words: Uint32Array;
    masks: Uint32Array;
};

type GpuState = {
    program: WebGLProgram;
    vertexShader: WebGLShader;
    fragmentShader: WebGLShader;
    positionBuffer: WebGLBuffer;
    texture: WebGLTexture;
    framebuffer: WebGLFramebuffer;
    iteration: WebGLUniformLocation;
    batchEnd: WebGLUniformLocation;
    batchCount: WebGLUniformLocation;
    hashData: WebGLUniformLocation;
    prefixWordCount: WebGLUniformLocation;
    prefixWords: WebGLUniformLocation;
    prefixMasks: WebGLUniformLocation;
    readback: Uint32Array;
};


// Turns a fingerprint prefix into word values and bit masks. A trailing odd
// nibble only sets the high half of its word mask.
function prefixMask(prefix: string): PrefixMask {
    const words = new Uint32Array(PREFIX_WORDS);
    const masks = new Uint32Array(PREFIX_WORDS);
    for (let index = 0; index < prefix.length; index++) {
        const word = index >> 3;
        const shift = 28 - (index % 8) * 4;
        words[word] = (words[word] | (parseInt(prefix[index], 16) << shift)) >>> 0;
        masks[word] = (masks[word] | (0xf << shift)) >>> 0;
    }
    return { wordCount: Math.ceil(prefix.length / 8), words, masks };
}


// Pads the public key packet hash input for SHA-1 and stores it as big endian
// uint32 words, which is the order the shader consumes. The final word holds the
// input length in bits.
function hashWords(packet: SecretPacket): Uint32Array {
    const fingerprintData = rawPacket(packet).writeForHash(4);
    const paddedBytes = Math.ceil((fingerprintData.length + 9) / 64) * 64;
    if (paddedBytes > MAX_PADDED_HASH_BYTES) throw new Error(`A ${fingerprintData.length} byte key packet exceeds the supported SHA-1 buffer.`);
    const bytes = new Uint8Array(paddedBytes);
    bytes.set(fingerprintData);
    bytes[fingerprintData.length] = 0x80;
    const words = new Uint32Array(bytes.buffer);
    for (let index = 0; index < words.length; index++) words[index] = swap32(words[index]);
    words[words.length - 1] = fingerprintData.length * 8;
    return words;
}

// A GPU hit is only accepted after the library and an independent SHA-1 digest
// agree on the fingerprint and the creation time is inside the frozen window.
async function verifyCandidate(role: KeyRole, packet: SecretPacket, timestamp: number, prefix: string, window: SearchWindow): Promise<VanityCandidate> {
    if (!Number.isInteger(timestamp) || timestamp < window.start || timestamp > window.end) throw new Error('The GPU returned a creation time outside the frozen search window.');
    packet.created = new Date(timestamp * 1000);
    await rawPacket(packet).computeFingerprintAndKeyID();
    const fingerprint = packet.getFingerprint();
    if (!fingerprint.toUpperCase().startsWith(prefix)) throw new Error('The GPU fingerprint does not match the requested prefix.');
    const publicBytes = rawPacket(packet).writeForHash(4) as Uint8Array<ArrayBuffer>;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', publicBytes));
    const hex = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    if (hex !== fingerprint) throw new Error('The GPU fingerprint does not match an independent SHA-1 digest of the key packet.');
    return { role, packet, fingerprint };
}

export async function searchVanityPacket(options: VanitySearchOptions): Promise<VanityCandidate | undefined> {
    const prefix = options.prefix.replace(/\s+/g, '').toUpperCase();
    if (!/^[0-9A-F]{1,40}$/.test(prefix)) throw new Error('A vanity prefix must be 1 to 40 hexadecimal characters.');
    const window = { ...options.window };
    for (const bound of [window.start, window.end]) {
        if (!Number.isInteger(bound) || bound < 0 || bound > 0xffffffff) throw new Error('Search window bounds must be whole uint32 seconds.');
    }
    if (window.start > window.end) throw new Error('The search window start must not be later than its end.');
    const { role, signal, onProgress, threads, iterations } = options;
    for (const [label, value] of [['GPU thread count', threads], ['GPU iteration count', iterations]] as const) {
        if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer.`);
    }

    const windowLength = window.end - window.start + 1;
    const side = Math.ceil(Math.sqrt(Math.min(threads, windowLength)));
    const canvas = new OffscreenCanvas(1, 1);
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('Vanity search needs WebGL2 with an integer framebuffer; this browser could not create a WebGL2 context.');
    const viewportLimit = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    const limit = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number, viewportLimit[0], viewportLimit[1]);
    if (side > limit) {
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        throw new Error(`A ${side}x${side} search canvas for ${threads} threads exceeds the device limit of ${limit} pixels per side. Lower the thread count.`);
    }
    canvas.width = side;
    canvas.height = side;

    const capacity = side * side;
    const maxBatch = Math.min(capacity * iterations, 0xffffffff - capacity + 1);
    const requestedPrefix = prefixMask(prefix);

    let contextLost = false;
    const onContextLost = () => { contextLost = true; };
    canvas.addEventListener('webglcontextlost', onContextLost);

    const compile = (type: number, source: string): WebGLShader => {
        const shader = gl.createShader(type);
        if (!shader) throw new Error('Unable to create a WebGL shader object.');
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(shader) ?? 'no shader info log';
            gl.deleteShader(shader);
            throw new Error(`WebGL shader compilation failed: ${log}`);
        }
        return shader;
    };

    const createGpu = (wordCount: number): GpuState => {
        if (wordCount < 16 || wordCount % 16 !== 0) throw new Error('Unexpected hashed key packet length.');
        const cleanup: Array<() => void> = [];
        try {
            const vertexShader = compile(gl.VERTEX_SHADER, vshaderString);
            cleanup.push(() => gl.deleteShader(vertexShader));
            const fragmentShader = compile(gl.FRAGMENT_SHADER, fshaderString.replace('#define __INJECTS__', `#define LENGTH (${wordCount})\n#define BLOCKS (${wordCount / 16})`));
            cleanup.push(() => gl.deleteShader(fragmentShader));
            const program = gl.createProgram();
            if (!program) throw new Error('Unable to create a WebGL program object.');
            cleanup.push(() => gl.deleteProgram(program));
            gl.attachShader(program, vertexShader);
            gl.attachShader(program, fragmentShader);
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                throw new Error(`WebGL program link failed: ${gl.getProgramInfoLog(program) ?? 'no program info log'}`);
            }
            gl.useProgram(program);

            const uniform = (name: string): WebGLUniformLocation => {
                const found = gl.getUniformLocation(program, name);
                if (!found) throw new Error(`WebGL uniform ${name} is missing from the compiled search shader.`);
                return found;
            };
            gl.uniform1ui(uniform('width'), side);
            gl.uniform1ui(uniform('height'), side);
            const iteration = uniform('iteration');
            const batchEnd = uniform('batchEnd');
            const batchCount = uniform('batchCount');
            const hashData = uniform('hashData');
            const prefixWordCount = uniform('prefixWordCount');
            const prefixWords = uniform('prefixWord');
            const prefixMasks = uniform('prefixMask');

            const positionBuffer = gl.createBuffer();
            if (!positionBuffer) throw new Error('Unable to create a WebGL buffer object.');
            cleanup.push(() => gl.deleteBuffer(positionBuffer));
            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
                -1, -1,
                 1, -1,
                -1,  1,
                -1,  1,
                 1, -1,
                 1,  1,
            ]), gl.STATIC_DRAW);
            const position = gl.getAttribLocation(program, 'pos');
            if (position < 0) throw new Error('The search vertex shader has no position attribute.');
            gl.enableVertexAttribArray(position);
            gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

            const texture = gl.createTexture();
            if (!texture) throw new Error('Unable to create a WebGL texture object.');
            cleanup.push(() => gl.deleteTexture(texture));
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, side, side, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, null);

            const framebuffer = gl.createFramebuffer();
            if (!framebuffer) throw new Error('Unable to create a WebGL framebuffer object.');
            cleanup.push(() => gl.deleteFramebuffer(framebuffer));
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
            if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`The integer framebuffer for the search is incomplete (0x${status.toString(16)}).`);
            gl.viewport(0, 0, side, side);

            return {
                program,
                vertexShader,
                fragmentShader,
                positionBuffer,
                texture,
                framebuffer,
                iteration,
                batchEnd,
                batchCount,
                hashData,
                prefixWordCount,
                prefixWords,
                prefixMasks,
                readback: new Uint32Array(capacity * 4),
            };
        } catch (error) {
            for (const undo of cleanup.reverse()) undo();
            throw error;
        }
    };

    let gpu: GpuState | undefined;
    let compiledWords = 0;
    const release = () => {
        if (!gpu) return;
        const state = gpu;
        gpu = undefined;
        gl.deleteProgram(state.program);
        gl.deleteShader(state.vertexShader);
        gl.deleteShader(state.fragmentShader);
        gl.deleteBuffer(state.positionBuffer);
        gl.deleteTexture(state.texture);
        gl.deleteFramebuffer(state.framebuffer);
    };

    const applyPrefix = (state: GpuState, mask: PrefixMask) => {
        gl.uniform1ui(state.prefixWordCount, mask.wordCount);
        gl.uniform1uiv(state.prefixWords, mask.words);
        gl.uniform1uiv(state.prefixMasks, mask.masks);
    };

    // Runs one batch and returns the highest timestamp that matched plus the
    // number of SHA-1 evaluations the pixels actually performed.
    const runBatch = (state: GpuState, batchEnd: number, count: number): { timestamp: number; attempts: number } => {
        gl.uniform1ui(state.iteration, Math.ceil(count / capacity));
        gl.uniform1ui(state.batchEnd, batchEnd);
        gl.uniform1ui(state.batchCount, count);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        if (contextLost || gl.isContextLost()) throw new Error('Lost the WebGL context during the vanity search.');
        gl.readPixels(0, 0, side, side, gl.RGBA_INTEGER, gl.UNSIGNED_INT, state.readback);
        let timestamp = -1;
        let attempts = 0;
        for (let index = 0; index < state.readback.length; index += 4) {
            attempts += state.readback[index + 2];
            if (state.readback[index] === 1 && state.readback[index + 1] > timestamp) timestamp = state.readback[index + 1];
        }
        return { timestamp, attempts };
    };

    const startTime = performance.now();
    let hashes = 0;
    let materials = 0;
    let sinceYield = startTime;
    let selfChecked = false;
    let current: SecretPacket | undefined;

    try {
        for (;;) {
            if (signal.aborted) return undefined;
            const candidate = await generateCandidate(role, new Date(window.end * 1000));
            const packet = candidate.packet;
            current = packet;
            materials += 1;

            const words = hashWords(packet);
            if (gpu && words.length !== compiledWords) throw new Error('Key material changed the hashed packet length during a search.');
            const state = gpu ?? createGpu(words.length);
            gpu = state;
            compiledWords = words.length;
            gl.uniform1uiv(state.hashData, words);

            // One off probe that is not part of the statistics: the CPU knows the
            // full fingerprint of this material, the GPU must reproduce it for the
            // single second already spent, through the same filter path.
            if (!selfChecked) {
                applyPrefix(state, prefixMask(packet.getFingerprint().toUpperCase()));
                const probe = runBatch(state, window.end, 1);
                if (probe.timestamp !== window.end || probe.attempts !== 1) {
                    throw new Error(`GPU self-check failed: expected creation time ${window.end} from 1 attempt, got ${probe.timestamp} from ${probe.attempts} attempts.`);
                }
                selfChecked = true;
            }
            applyPrefix(state, requestedPrefix);

            let batchEnd = window.end;
            let remaining = windowLength;
            let hit = -1;
            while (remaining > 0) {
                if (signal.aborted) return undefined;
                const count = Math.min(remaining, maxBatch);
                const batch = runBatch(state, batchEnd, count);
                hashes += batch.attempts;
                remaining -= count;
                batchEnd -= count;
                onProgress?.({ hashes, materials, elapsedMs: performance.now() - startTime });
                if (batch.timestamp >= 0) {
                    hit = batch.timestamp;
                    break;
                }
                if (performance.now() - sinceYield >= YIELD_INTERVAL_MS) {
                    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
                    sinceYield = performance.now();
                }
            }

            if (hit >= 0) {
                if (signal.aborted) return undefined;
                const verified = await verifyCandidate(role, packet, hit, prefix, window);
                if (signal.aborted) return undefined;
                current = undefined;
                return verified;
            }

            rawPacket(packet).clearPrivateParams();
            current = undefined;
        }
    } finally {
        if (current) rawPacket(current).clearPrivateParams();
        canvas.removeEventListener('webglcontextlost', onContextLost);
        release();
        gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
}
