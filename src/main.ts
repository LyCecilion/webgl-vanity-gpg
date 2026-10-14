/**
 * Local vanity key manager.
 *
 * `currentDocument` is the single certificate of this page. It is deliberately kept outside the
 * petite-vue scope: the scope is deeply proxied, and proxying key documents, abort signals or
 * candidate packets would break their methods and leak secret material into reactive state. The
 * template only sees plain summary values (strings, numbers, booleans and plain row objects).
 *
 * Every operation follows the same shape: validate and freeze the search window synchronously
 * (errors surface without touching any state), run the search/signing work, publish the result as
 * a new `KeyDocument`, and release everything the operation owned in `finally`.
 */
import { createApp } from 'petite-vue';
import { enums } from 'openpgp';
import type { AlgorithmInfo, PrivateKey, SignaturePacket, Subkey, UserID } from 'openpgp';
import { exportDeviceKey } from './device-export.ts';
import { armorKeyDocument, armorPublicDocument, importKeyDocument } from './key-document.ts';
import type { KeyDocument } from './key-document.ts';
import { appendSubkeys, createPrimaryDocument, renewKey } from './key-lifecycle.ts';
import type { Protection } from './key-lifecycle.ts';
import { fullConfig, rawPacket } from './openpgp-packets.ts';
import type { KeyRole, VanityCandidate } from './openpgp-packets.ts';
import { resolveExpiration, resolveSearchWindow } from './time-window.ts';
import type { SearchWindow, TimeSelection, TimeZoneMode } from './time-window.ts';
import { searchVanityPacket } from './vanity-key.ts';
import type { SearchProgress } from './vanity-key.ts';
import tadaData from './tada.ogg?inline';
import 'terminal.css';

type Zone = TimeZoneMode;
type DateMode = 'today' | 'day' | 'range';
type ExpiryMode = 'never' | 'date';
type KeyRoleLabel = 'primary' | 'signing' | 'encryption' | 'unknown';

type CertificateRow = {
    fingerprint: string;
    primary: boolean;
    role: KeyRoleLabel;
    algorithm: string;
    usage: string;
    createdMs: number;
    /** `null` means "never expires"; check `expirationKnown` first. */
    expirationMs: number | null;
    expirationKnown: boolean;
    expired: boolean;
    revoked: boolean;
    hasSecret: boolean;
};

type SearchBase = {
    hashes: number;
    materials: number;
    elapsedMs: number;
    total: number;
    completed: number;
};

type ProgressSnapshot = {
    role: KeyRoleLabel | '';
    completed: number;
    total: number;
    hashes: number;
    materials: number;
    elapsedMs: number;
};

type SecretPacketAccess = {
    isDummy(): boolean;
    algorithm: number;
};

type PreparedCreate = {
    userIDs: readonly UserID[];
    prefix: string;
    range: SearchWindow;
    windowText: string;
    expiresAt: Date | null;
    protection: Protection;
    threads: number;
    iterations: number;
};

type PreparedAdd = {
    document: KeyDocument;
    signing: number;
    encryption: number;
    prefix: string;
    range: SearchWindow;
    windowText: string;
    expiresAt: Date | null;
    protection: Protection;
    primaryPassphrase: string;
    threads: number;
    iterations: number;
};

type PreparedRenew = {
    document: KeyDocument;
    fingerprints: string[];
    expiresAt: Date | null;
    passphrase: string;
    subkeyPassphrases: Record<string, string>;
};

type PreparedDevice = {
    document: KeyDocument;
    fingerprints: string[];
    passphrases: Record<string, string>;
    protection: Protection;
};

/** Thrown by the search helper when the user stopped the operation. */
class CancelledOperation extends Error {
    constructor() {
        super('操作已取消。');
    }
}

const localTimeZoneName = Intl.DateTimeFormat().resolvedOptions().timeZone || '本机时区';
const tada = new Audio(tadaData);

let currentDocument: KeyDocument | undefined;
let activeAbort: AbortController | undefined;
let progressTimer: number | undefined;
let lastProgressFlush = 0;
let progressSnapshot: ProgressSnapshot = { role: '', completed: 0, total: 0, hashes: 0, materials: 0, elapsedMs: 0 };
let beforeUnloadAttached = false;
let operationStarted = 0;

/**
 * Wall-clock stamps in the requested zone. The `sv-SE` locale is what makes `Intl` emit the
 * ISO-like `YYYY-MM-DD HH:mm:ss` shape, so no second date formatter has to be maintained.
 */
const stampOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
};
const localStamp = new Intl.DateTimeFormat('sv-SE', stampOptions);
const utcStamp = new Intl.DateTimeFormat('sv-SE', { ...stampOptions, timeZone: 'UTC' });
let autoAddExpiry = defaultSubkeyExpiry('local');

function stamp(ms: number, zone: Zone): string {
    return (zone === 'utc' ? utcStamp : localStamp).format(ms);
}

/** Selected subkey default expiration: the date 365 days from now, read in the chosen zone. */
function defaultSubkeyExpiry(zone: Zone): string {
    return stamp(Date.now() + 365 * 86400000, zone).slice(0, 10);
}

function validatePrefix(prefix: string): void {
    if (!/^[0-9a-fA-F]{1,40}$/.test(prefix.replace(/\s+/g, ''))) {
        throw new Error('指纹前缀必须是 1 到 40 个十六进制字符（0-9、A-F），空格会被忽略。');
    }
}

function positiveInteger(value: unknown, label: string): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label}必须是正整数。`);
    return parsed;
}

function nonNegativeInteger(value: unknown, label: string): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label}必须是非负整数。`);
    return parsed;
}

/** Device names are only used for the file name, so path separators and control characters go. */
function sanitizeDeviceName(name: string): string {
    const cleaned = name.replace(/[\u0000-\u001f\u007f/\\]/g, '').trim();
    return cleaned || 'device';
}

function downloadFile(filename: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/pgp-keys; charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    // The browser reads the blob asynchronously, so the URL is released on a later task.
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function beforeUnloadHandler(event: BeforeUnloadEvent): void {
    event.preventDefault();
    event.returnValue = '';
}

/** Capabilities an algorithm can carry on its own; used when a key declares no key flags. */
function algorithmCapabilities(algorithm: number): string[] {
    switch (algorithm) {
        case enums.publicKey.rsaEncryptSign:
            return ['S', 'E'];
        case enums.publicKey.rsaEncrypt:
        case enums.publicKey.elgamal:
            return ['E'];
        case enums.publicKey.rsaSign:
        case enums.publicKey.dsa:
        case enums.publicKey.ecdsa:
            return ['S'];
        case enums.publicKey.ecdh:
            return ['E'];
        case enums.publicKey.eddsaLegacy:
            return ['S'];
        default:
            return [];
    }
}

function usageText(primary: boolean, algorithm: number, flags: readonly number[]): string {
    const capabilities: string[] = [];
    if (flags.includes(enums.keyFlags.certifyKeys)) capabilities.push('C');
    if (flags.includes(enums.keyFlags.signData)) capabilities.push('S');
    if (flags.includes(enums.keyFlags.encryptCommunication) || flags.includes(enums.keyFlags.encryptStorage)) capabilities.push('E');
    if (flags.includes(enums.keyFlags.authentication)) capabilities.push('A');
    if (capabilities.length > 0) return capabilities.join('+');
    if (primary) return 'C';
    const fallback = algorithmCapabilities(algorithm);
    return fallback.length > 0 ? fallback.join('+') : '?';
}

function keyRole(primary: boolean, algorithm: number, flags: readonly number[]): KeyRoleLabel {
    if (primary) return 'primary';
    const text = usageText(false, algorithm, flags);
    if (text.includes('S')) return 'signing';
    if (text.includes('E')) return 'encryption';
    return 'unknown';
}

/** Display the newest currently valid certification, never unverified or future metadata. */
async function verifiedKeyFlags(key: PrivateKey, now: Date, subkey?: Subkey): Promise<number[]> {
    if (!subkey) {
        const primary = await key.getPrimaryUser(now, undefined, fullConfig).catch(() => undefined);
        return Array.from(primary?.selfCertification.keyFlags ?? []);
    }
    let newest: SignaturePacket | undefined;
    for (const signature of subkey.bindingSignatures) {
        if (!signature.created || signature.created > now || signature.isExpired(now)) continue;
        try {
            await signature.verify(key.keyPacket, enums.signature.subkeyBinding, { key: key.keyPacket, bind: subkey.keyPacket }, now, undefined, fullConfig);
        } catch {
            continue; // Invalid metadata cannot describe the displayed certificate's permissions.
        }
        if (!newest || signature.created > newest.created!) newest = signature;
    }
    return Array.from(newest?.keyFlags ?? []);
}

/** `Key.keyPacket` is typed as a public/secret union, so the secret-only accessors need an interface. */
function secretAccess(packet: unknown): SecretPacketAccess {
    return packet as SecretPacketAccess;
}

function algorithmText(info: AlgorithmInfo): string {
    const detail = info.bits ? `${info.bits} bit` : info.curve ? `${info.curve}` : '';
    return detail ? `${info.algorithm}（${detail}）` : info.algorithm;
}

const app = {
    // global display state
    soundEnabled: false,
    viewZone: 'local' as Zone,
    localTimeZoneName,
    statusMessage: '',
    errorMessage: '',
    running: false,
    stoppable: false,
    searchWindowText: '',

    // current certificate summary
    hasDocument: false,
    documentFingerprint: '',
    documentUserIDs: [] as string[],
    certificateRows: [] as CertificateRow[],
    dirtyBackup: false,
    backupStarted: false,
    addBlockedReason: '请先创建或导入证书。',
    renewBlockedReason: '请先创建或导入证书。',

    // search progress
    progressRole: '' as KeyRoleLabel | '',
    progressCompleted: 0,
    progressTotal: 0,
    progressHashes: 0,
    progressMaterials: 0,
    progressElapsedMs: 0,

    // create a primary key
    createPrefix: '4A2E117A',
    createUIDInput: { name: '', comment: '', email: '' } as UserID,
    createUIDs: [] as UserID[],
    createDateMode: 'day' as DateMode,
    createDate: stamp(Date.now(), 'local').slice(0, 10),
    createRangeStart: '',
    createRangeEnd: '',
    createZone: 'local' as Zone,
    createExpiryMode: 'never' as ExpiryMode,
    createExpiryDate: '',
    createPassphrase: '',
    createPassphraseConfirm: '',
    createAllowUnprotected: false,
    createThreads: 65536,
    createIterations: 8,

    // import
    importText: '',

    // add subkeys
    addCount: 1,
    addEncryption: false,
    addPrefix: '4217',
    addDateMode: 'today' as DateMode,
    addDate: stamp(Date.now(), 'local').slice(0, 10),
    addRangeStart: '',
    addRangeEnd: '',
    addZone: 'local' as Zone,
    addExpiryMode: 'date' as ExpiryMode,
    addExpiryDate: autoAddExpiry,
    addPrimaryPassphrase: '',
    addPassphrase: '',
    addPassphraseConfirm: '',
    addAllowUnprotected: false,
    addThreads: 65536,
    addIterations: 8,

    // renew
    renewZone: 'local' as Zone,
    renewSelection: {} as Record<string, boolean>,
    renewSubkeyPassphrases: {} as Record<string, string>,
    renewPassphrase: '',
    renewExpiryMode: 'date' as ExpiryMode,
    renewExpiryDate: '',

    // export
    backupAcknowledged: false,
    deviceName: '',
    deviceSelection: {} as Record<string, boolean>,
    deviceSubkeyPassphrases: {} as Record<string, string>,
    devicePassphrase: '',
    devicePassphraseConfirm: '',
    deviceAllowUnprotected: false,

    mounted(): void {
        this.refreshAddExpiry();
        this.syncBeforeUnload();
    },

    // ---------------------------------------------------------------- little display helpers

    formatFingerprint(value: string): string {
        return value.toUpperCase().replace(/\s+/g, '').match(/.{1,4}/g)?.join(' ') ?? value;
    },

    formatUserID(uid: UserID): string {
        const name = (uid.name ?? '').trim();
        const comment = (uid.comment ?? '').trim();
        const email = (uid.email ?? '').trim();
        const head = comment ? `${name} (${comment})` : name;
        return email ? `${head} <${email}>`.trim() : head;
    },

    rowCreated(row: CertificateRow): string {
        const utc = `${stamp(row.createdMs, 'utc')} UTC`;
        if (this.viewZone === 'utc') return utc;
        return `${stamp(row.createdMs, 'local')}（${localTimeZoneName}）/ ${utc}`;
    },

    rowExpiry(row: CertificateRow): string {
        if (!row.expirationKnown) return '没有有效的自认证，无法判断';
        if (row.expirationMs === null) return '永不过期';
        const moment = `${stamp(row.expirationMs, this.viewZone)}（${this.viewZone === 'utc' ? 'UTC' : localTimeZoneName}）`;
        return row.expired ? `${moment}，已过期` : moment;
    },

    roleText(role: KeyRoleLabel | ''): string {
        if (role === 'primary') return '主钥';
        if (role === 'signing') return '签名子钥';
        if (role === 'encryption') return '加密子钥';
        return '未开始';
    },

    formatDuration(ms: number): string {
        return `${(ms / 1000).toFixed(2)} s`;
    },

    // ---------------------------------------------------------------- messages

    clearMessages(): void {
        this.statusMessage = '';
        this.errorMessage = '';
    },

    setStatus(message: string): void {
        this.statusMessage = message;
        this.errorMessage = '';
    },

    setError(error: unknown): void {
        this.errorMessage = error instanceof Error ? error.message : String(error);
    },

    // ---------------------------------------------------------------- progress

    resetProgress(): void {
        if (progressTimer !== undefined) {
            window.clearTimeout(progressTimer);
            progressTimer = undefined;
        }
        progressSnapshot = { role: '', completed: 0, total: 0, hashes: 0, materials: 0, elapsedMs: 0 };
        this.flushProgress();
    },

    /** Renders at most every 100 ms; `flushProgress` is called again when the operation ends. */
    reportProgress(role: KeyRoleLabel, base: SearchBase, progress: SearchProgress): void {
        progressSnapshot = {
            role,
            completed: base.completed,
            total: base.total,
            hashes: base.hashes + progress.hashes,
            materials: base.materials + progress.materials,
            elapsedMs: base.elapsedMs + progress.elapsedMs,
        };
        const since = performance.now() - lastProgressFlush;
        if (since >= 100) {
            this.flushProgress();
        } else if (progressTimer === undefined) {
            progressTimer = window.setTimeout(() => this.flushProgress(), Math.ceil(100 - since));
        }
    },

    flushProgress(): void {
        if (progressTimer !== undefined) {
            window.clearTimeout(progressTimer);
            progressTimer = undefined;
        }
        lastProgressFlush = performance.now();
        this.progressRole = progressSnapshot.role;
        this.progressCompleted = progressSnapshot.completed;
        this.progressTotal = progressSnapshot.total;
        this.progressHashes = progressSnapshot.hashes;
        this.progressMaterials = progressSnapshot.materials;
        this.progressElapsedMs = progressSnapshot.elapsedMs;
    },

    // ---------------------------------------------------------------- operation lifecycle

    startOperation(stoppable: boolean): void {
        this.running = true;
        operationStarted = performance.now();
        this.stoppable = stoppable;
        this.searchWindowText = '';
        activeAbort = stoppable ? new AbortController() : undefined;
        this.resetProgress();
    },

    finishOperation(): void {
        this.running = false;
        this.stoppable = false;
        activeAbort = undefined;
        if (progressSnapshot.total > 0) progressSnapshot.elapsedMs = performance.now() - operationStarted;
        this.clearSecrets();
        this.flushProgress();
    },

    /** Passphrases and unlock references belong to one operation and are dropped when it settles. */
    clearSecrets(): void {
        this.createPassphrase = '';
        this.createPassphraseConfirm = '';
        this.addPrimaryPassphrase = '';
        this.addPassphrase = '';
        this.addPassphraseConfirm = '';
        this.renewPassphrase = '';
        this.renewSubkeyPassphrases = {};
        this.devicePassphrase = '';
        this.devicePassphraseConfirm = '';
        this.deviceSubkeyPassphrases = {};
    },

    stopSearch(): void {
        if (!this.running || !this.stoppable) return;
        this.setStatus('正在停止搜索…');
        activeAbort?.abort();
    },

    assertNotCancelled(): void {
        if (activeAbort?.signal.aborted) throw new CancelledOperation();
    },

    clearCandidates(candidates: readonly VanityCandidate[], unpublished?: KeyDocument): void {
        for (const candidate of candidates) {
            const packet = rawPacket(candidate.packet);
            if (packet.isDecrypted()) packet.clearPrivateParams();
        }
        if (unpublished && unpublished !== currentDocument) {
            const primary = rawPacket(unpublished.key.keyPacket);
            if (primary.isDecrypted()) primary.clearPrivateParams();
            for (const subkey of unpublished.key.subkeys) {
                const packet = rawPacket(subkey.keyPacket);
                if (packet.isDecrypted()) packet.clearPrivateParams();
            }
        }
    },

    playSuccessSound(): void {
        if (!this.soundEnabled) return;
        tada.currentTime = 0;
        void tada.play().catch(() => undefined);
    },

    async searchCandidate(role: KeyRole, prefix: string, range: SearchWindow, threads: number, iterations: number, base: SearchBase): Promise<VanityCandidate> {
        const signal = activeAbort?.signal;
        if (!signal) throw new Error('搜索缺少取消信号，请重新开始操作。');
        let latest: SearchProgress = { hashes: 0, materials: 0, elapsedMs: 0 };
        const candidate = await searchVanityPacket({
            role,
            prefix,
            window: range,
            threads,
            iterations,
            signal,
            onProgress: (progress) => {
                latest = progress;
                this.reportProgress(role, base, progress);
            },
        });
        if (!candidate) throw new CancelledOperation();
        base.completed += 1;
        base.hashes += latest.hashes;
        base.materials += latest.materials;
        base.elapsedMs += latest.elapsedMs;
        progressSnapshot = { role, ...base };
        this.flushProgress();
        return candidate;
    },

    // ---------------------------------------------------------------- validation helpers

    buildProtection(passphrase: string, confirm: string, allowUnprotected: boolean): Protection {
        if (passphrase !== confirm) throw new Error('两次输入的保护口令不一致。');
        if (!passphrase && !allowUnprotected) throw new Error('请设置非空保护口令，或显式勾选「允许未加密私钥」。');
        return { passphrase, allowUnprotected };
    },

    selectionOf(mode: DateMode, date: string, start: string, end: string, zone: Zone): TimeSelection {
        // Native datetime-local controls omit ":00" seconds at exact minute boundaries.
        if (mode === 'range') return { mode: 'range', start: start.length === 16 ? `${start}:00` : start, end: end.length === 16 ? `${end}:00` : end, zone };
        return { mode, date, zone };
    },

    describeWindow(range: SearchWindow, zone: Zone, now: Date, notBefore?: Date): string {
        const notes: string[] = [];
        if (range.end === Math.floor(now.getTime() / 1000)) notes.push('结束时刻已裁剪为当前时刻');
        if (notBefore && range.start === Math.ceil(notBefore.getTime() / 1000)) notes.push('起点已裁剪为原主钥创建时刻');
        const suffix = notes.length > 0 ? `（${notes.join('；')}）` : '';
        return `搜索范围已冻结：${stamp(range.start * 1000, zone)} → ${stamp(range.end * 1000, zone)}（${zone === 'utc' ? 'UTC' : localTimeZoneName}），共 ${range.end - range.start + 1} 个候选秒${suffix}。密钥创建时间只取自这个范围；线程数与迭代数只决定 GPU 批次，不决定密钥生日。`;
    },

    replaceConfirmation(): boolean {
        if (!currentDocument || !this.dirtyBackup) return true;
        return window.confirm('当前证书有尚未确认保存的完整私钥备份。替换证书会丢失这些变更，确定继续吗？');
    },

    syncBeforeUnload(): void {
        const needed = this.hasDocument && this.dirtyBackup;
        if (needed && !beforeUnloadAttached) {
            window.addEventListener('beforeunload', beforeUnloadHandler);
            beforeUnloadAttached = true;
        } else if (!needed && beforeUnloadAttached) {
            window.removeEventListener('beforeunload', beforeUnloadHandler);
            beforeUnloadAttached = false;
        }
    },

    refreshAddExpiry(): void {
        const next = defaultSubkeyExpiry(this.addZone);
        if (!this.addExpiryDate || this.addExpiryDate === autoAddExpiry) this.addExpiryDate = next;
        autoAddExpiry = next;
    },

    // ---------------------------------------------------------------- document state

    async applyDocument(document: KeyDocument, dirtyBackup: boolean): Promise<void> {
        currentDocument = document;
        this.hasDocument = true;
        this.dirtyBackup = dirtyBackup;
        this.backupStarted = false;
        this.backupAcknowledged = false;
        this.renewSelection = {};
        this.renewSubkeyPassphrases = {};
        this.deviceSelection = {};
        this.deviceSubkeyPassphrases = {};
        this.documentFingerprint = document.key.getFingerprint().toUpperCase();
        this.documentUserIDs = document.key.getUserIDs();
        await this.refreshRows();
        this.syncBeforeUnload();
    },

    /**
     * Display-only expiration lookup. `null` means the library found no valid self-certification
     * (including an unusable binding that would otherwise abort the whole import), `Infinity` means
     * "never expires".
     */
    async expirationOf(lookup: Promise<Date | number | null>): Promise<{ ms: number | null; known: boolean }> {
        const value = await lookup.catch(() => null);
        if (value instanceof Date) return { ms: value.getTime(), known: true };
        return { ms: null, known: value !== null };
    },

    renewReason(row: CertificateRow): string {
        if (row.revoked) return '已撤销，不能续期';
        if (!row.expirationKnown) return '没有有效的自认证，无法判断到期时间，不能续期';
        if (row.expirationMs === null) return '永不过期，不能续期';
        if (!row.primary && row.role === 'unknown') return '算法不支持或用途未知，不能续期';
        return '';
    },

    deviceReason(row: CertificateRow): string {
        if (row.primary) return '设备文件不包含主钥，不能选择';
        if (!row.hasSecret) return '缺少秘密材料，不能选择';
        if (row.revoked) return '已撤销，不能用于新设备';
        if (row.expired) return '已过期，请先延长有效期';
        if (!row.expirationKnown) return '没有有效的自认证，不能用于新设备';
        return '';
    },

    async refreshRows(): Promise<void> {
        const document = currentDocument;
        if (!document) {
            this.hasDocument = false;
            this.documentFingerprint = '';
            this.documentUserIDs = [];
            this.certificateRows = [];
            this.addBlockedReason = '请先创建或导入证书。';
            this.renewBlockedReason = '请先创建或导入证书。';
            return;
        }
        const key = document.key;
        const now = new Date();
        const rows: CertificateRow[] = [];

        const primaryPacket = secretAccess(key.keyPacket);
        const primaryExpiration = await this.expirationOf(key.getExpirationTime(undefined, fullConfig));
        rows.push({
            fingerprint: key.getFingerprint().toUpperCase(),
            primary: true,
            role: 'primary',
            algorithm: algorithmText(key.getAlgorithmInfo()),
            usage: usageText(true, key.keyPacket.algorithm, await verifiedKeyFlags(key, now)),
            createdMs: key.getCreationTime().getTime(),
            expirationMs: primaryExpiration.ms,
            expirationKnown: primaryExpiration.known,
            expired: primaryExpiration.ms !== null && primaryExpiration.ms <= now.getTime(),
            revoked: await key.isRevoked(undefined, undefined, now, fullConfig),
            hasSecret: !primaryPacket.isDummy(),
        });
        for (const subkey of key.subkeys) {
            const packet = secretAccess(subkey.keyPacket);
            const flags = await verifiedKeyFlags(key, now, subkey);
            const expiration = await this.expirationOf(subkey.getExpirationTime(now, fullConfig));
            rows.push({
                fingerprint: subkey.getFingerprint().toUpperCase(),
                primary: false,
                role: keyRole(false, packet.algorithm, flags),
                algorithm: algorithmText(subkey.getAlgorithmInfo()),
                usage: usageText(false, packet.algorithm, flags),
                createdMs: subkey.getCreationTime().getTime(),
                expirationMs: expiration.ms,
                expirationKnown: expiration.known,
                expired: expiration.ms !== null && expiration.ms <= now.getTime(),
                revoked: await subkey.isRevoked(subkey.bindingSignatures[0], key.keyPacket, now, fullConfig),
                hasSecret: !packet.isDummy(),
            });
        }

        this.certificateRows = rows;
        const primaryRow = rows[0];
        const addReasons: string[] = [];
        if (!primaryRow.hasSecret) addReasons.push('主钥缺少秘密材料，无法签发新的子钥绑定。');
        if (primaryRow.revoked) addReasons.push('主钥已被撤销，不能添加子钥。');
        if (primaryRow.expired) addReasons.push('主钥已过期，请先在「延长有效期」中续期再添加子钥。');
        if (!primaryRow.expirationKnown) addReasons.push('主钥没有有效的自认证，无法签发新的子钥绑定。');
        this.addBlockedReason = addReasons.join(' ');

        const renewReasons: string[] = [];
        if (!primaryRow.hasSecret) renewReasons.push('主钥缺少秘密材料，无法签发新的签名。');
        if (primaryRow.revoked) renewReasons.push('主钥已被撤销，不能续期。');
        if (!primaryRow.expirationKnown) renewReasons.push('主钥没有有效的自认证，无法续期。');
        this.renewBlockedReason = renewReasons.join(' ');
    },

    // ---------------------------------------------------------------- create primary

    addCreateUID(): void {
        const input = this.createUIDInput;
        const name = (input.name ?? '').trim();
        const comment = (input.comment ?? '').trim();
        const email = (input.email ?? '').trim();
        if (!name && !comment && !email) {
            this.setError('用户 ID 不能为空，至少填写姓名或邮箱。');
            return;
        }
        this.createUIDs.push({ name, comment, email } as UserID);
        this.createUIDInput = { name: '', comment: '', email: '' };
        this.setStatus(`已暂存用户 ID：${this.formatUserID({ name, comment, email } as UserID)}。`);
    },

    removeCreateUID(index: number): void {
        this.createUIDs.splice(index, 1);
    },

    prepareCreate(): PreparedCreate {
        const userIDs = this.createUIDs.map(uid => ({ ...uid }));
        if (userIDs.length === 0) throw new Error('请先添加至少一个用户 ID。');
        const prefix = this.createPrefix;
        validatePrefix(prefix);
        const now = new Date();
        const range = resolveSearchWindow(
            this.selectionOf(this.createDateMode, this.createDate, this.createRangeStart, this.createRangeEnd, this.createZone),
            now,
        );
        if (this.createExpiryMode === 'date' && !this.createExpiryDate) throw new Error('请选择到期日期，或改为「永不过期」。');
        const expiresAt = this.createExpiryMode === 'never' ? null : resolveExpiration(this.createExpiryDate, this.createZone);
        if (expiresAt && expiresAt.getTime() <= now.getTime()) throw new Error('到期时刻必须晚于当前时间。');
        return {
            userIDs,
            prefix,
            range,
            windowText: this.describeWindow(range, this.createZone, now),
            expiresAt,
            protection: this.buildProtection(this.createPassphrase, this.createPassphraseConfirm, this.createAllowUnprotected),
            threads: positiveInteger(this.createThreads, '线程数'),
            iterations: positiveInteger(this.createIterations, '迭代数'),
        };
    },

    async createPrimary(): Promise<void> {
        if (this.running) return;
        this.clearMessages();
        let prepared: PreparedCreate;
        try {
            prepared = this.prepareCreate();
        } catch (error) {
            this.setError(error);
            return;
        }
        const candidates: VanityCandidate[] = [];
        let document: KeyDocument | undefined;
        this.startOperation(true);
        this.searchWindowText = prepared.windowText;
        try {
            const base: SearchBase = { hashes: 0, materials: 0, elapsedMs: 0, total: 1, completed: 0 };
            const candidate = await this.searchCandidate('primary', prepared.prefix, prepared.range, prepared.threads, prepared.iterations, base);
            candidates.push(candidate);
            this.assertNotCancelled();
            document = await createPrimaryDocument(candidate, prepared.userIDs, prepared.expiresAt, prepared.protection);
            this.assertNotCancelled();
            if (!this.replaceConfirmation()) {
                this.setStatus('已保留当前证书，未替换。');
                return;
            }
            await this.applyDocument(document, true);
            this.setStatus(`已创建主钥 ${this.formatFingerprint(this.documentFingerprint)}。请在「导出」中下载完整私钥备份。`);
            this.playSuccessSound();
        } catch (error) {
            if (error instanceof CancelledOperation) this.setStatus('已取消，当前证书保持不变。');
            else this.setError(error);
        } finally {
            this.clearCandidates(candidates, document);
            this.finishOperation();
        }
    },

    // ---------------------------------------------------------------- import

    async importFile(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        try {
            if (this.running) {
                this.setError('已有操作在进行中，请先等待或停止。');
                return;
            }
            let armored: string;
            try {
                armored = await file.text();
            } catch (error) {
                this.setError(error);
                return;
            }
            await this.importArmored(armored, false);
        } finally {
            // Clearing the value lets the same file be selected again; the File object is read first.
            input.value = '';
        }
    },

    async importKey(): Promise<void> {
        await this.importArmored(this.importText, true);
    },

    async importArmored(armored: string, fromPaste: boolean): Promise<void> {
        if (this.running) return;
        this.clearMessages();
        if (!armored.trim()) {
            this.setError('请选择 .asc 文件或粘贴私钥文本。');
            return;
        }
        this.startOperation(false);
        try {
            const document = await importKeyDocument(armored);
            if (!this.replaceConfirmation()) {
                this.setStatus('已保留当前证书，未导入。');
                return;
            }
            await this.applyDocument(document, false);
            if (fromPaste) this.importText = '';
            this.setStatus(`已导入证书 ${this.formatFingerprint(this.documentFingerprint)}，视为已备份状态。`);
        } catch (error) {
            this.setError(error);
        } finally {
            this.finishOperation();
        }
    },

    // ---------------------------------------------------------------- add subkeys

    prepareAddSubkeys(): PreparedAdd {
        const document = currentDocument;
        if (!document) throw new Error('尚未加载证书。');
        const signing = nonNegativeInteger(this.addCount, '签名子钥数量');
        const encryption = this.addEncryption ? 1 : 0;
        if (signing + encryption === 0) throw new Error('请至少选择一把子钥（签名子钥数量大于 0 或勾选加密子钥）。');
        const prefix = this.addPrefix;
        validatePrefix(prefix);
        const now = new Date();
        const primaryCreated = document.key.getCreationTime();
        const range = resolveSearchWindow(
            this.selectionOf(this.addDateMode, this.addDate, this.addRangeStart, this.addRangeEnd, this.addZone),
            now,
            primaryCreated,
        );
        if (this.addExpiryMode === 'date' && !this.addExpiryDate) throw new Error('请选择子钥到期日期，或改为「永不过期」。');
        const expiresAt = this.addExpiryMode === 'never' ? null : resolveExpiration(this.addExpiryDate, this.addZone);
        return {
            document,
            signing,
            encryption,
            prefix,
            range,
            windowText: this.describeWindow(range, this.addZone, now, primaryCreated),
            expiresAt,
            protection: this.buildProtection(this.addPassphrase, this.addPassphraseConfirm, this.addAllowUnprotected),
            primaryPassphrase: this.addPrimaryPassphrase,
            threads: positiveInteger(this.addThreads, '线程数'),
            iterations: positiveInteger(this.addIterations, '迭代数'),
        };
    },

    async addSubkeys(): Promise<void> {
        if (this.running) return;
        this.clearMessages();
        let prepared: PreparedAdd;
        try {
            prepared = this.prepareAddSubkeys();
        } catch (error) {
            this.setError(error);
            return;
        }
        const candidates: VanityCandidate[] = [];
        let updated: KeyDocument | undefined;
        this.startOperation(true);
        this.searchWindowText = prepared.windowText;
        try {
            const base: SearchBase = {
                hashes: 0,
                materials: 0,
                elapsedMs: 0,
                total: prepared.signing + prepared.encryption,
                completed: 0,
            };
            for (let index = 0; index < prepared.signing; index++) {
                candidates.push(await this.searchCandidate('signing', prepared.prefix, prepared.range, prepared.threads, prepared.iterations, base));
            }
            for (let index = 0; index < prepared.encryption; index++) {
                candidates.push(await this.searchCandidate('encryption', prepared.prefix, prepared.range, prepared.threads, prepared.iterations, base));
            }
            this.assertNotCancelled();
            // Nothing is published before every candidate hit and the bindings are signed.
            updated = await appendSubkeys(prepared.document, candidates, prepared.expiresAt, prepared.primaryPassphrase, prepared.protection);
            this.assertNotCancelled();
            await this.applyDocument(updated, true);
            this.setStatus(`已添加 ${candidates.length} 把子钥：${candidates.map(candidate => this.formatFingerprint(candidate.fingerprint)).join('、')}。请在「导出」中下载完整私钥备份。`);
            this.playSuccessSound();
        } catch (error) {
            if (error instanceof CancelledOperation) this.setStatus('已取消，当前证书保持不变，搜索结果未发布。');
            else this.setError(error);
        } finally {
            this.clearCandidates(candidates, updated);
            this.finishOperation();
        }
    },

    // ---------------------------------------------------------------- renew

    renewDisabled(): boolean {
        if (this.running || !this.hasDocument || this.renewBlockedReason !== '') return true;
        return !this.certificateRows.some(row => this.renewSelection[row.fingerprint] === true && this.renewReason(row) === '');
    },

    prepareRenewal(): PreparedRenew {
        const document = currentDocument;
        if (!document) throw new Error('尚未加载证书。');
        const selected = this.certificateRows.filter(row => this.renewSelection[row.fingerprint] === true);
        if (selected.length === 0) throw new Error('请选择至少一个要续期的密钥。');
        const rejected = selected.filter(row => this.renewReason(row) !== '');
        if (rejected.length > 0) {
            throw new Error(`以下密钥不能续期：${rejected.map(row => `${this.formatFingerprint(row.fingerprint)}（${this.renewReason(row)}）`).join('、')}。`);
        }
        if (this.renewExpiryMode === 'date' && !this.renewExpiryDate) throw new Error('请选择新的到期日期，或改为「永不过期」。');
        const expiresAt = this.renewExpiryMode === 'never' ? null : resolveExpiration(this.renewExpiryDate, this.renewZone);
        if (expiresAt) {
            if (expiresAt.getTime() <= Date.now()) throw new Error('新的到期时刻必须晚于当前时间。');
            const shortened = selected.filter(row => row.expirationMs !== null && expiresAt.getTime() <= row.expirationMs);
            if (shortened.length > 0) {
                throw new Error(`续期不能缩短有效期：新的到期时刻必须晚于 ${shortened.map(row => this.formatFingerprint(row.fingerprint)).join('、')} 当前的到期时刻。`);
            }
        }
        const subkeyPassphrases: Record<string, string> = {};
        for (const row of selected) {
            if (row.role !== 'signing') continue;
            const passphrase = this.renewSubkeyPassphrases[row.fingerprint];
            if (passphrase) subkeyPassphrases[row.fingerprint] = passphrase;
        }
        return {
            document,
            fingerprints: selected.map(row => row.fingerprint),
            expiresAt,
            passphrase: this.renewPassphrase,
            subkeyPassphrases,
        };
    },

    async renewSelected(): Promise<void> {
        if (this.running) return;
        this.clearMessages();
        let prepared: PreparedRenew;
        try {
            prepared = this.prepareRenewal();
        } catch (error) {
            this.setError(error);
            return;
        }
        this.startOperation(false);
        try {
            const updated = await renewKey(prepared.document, prepared.fingerprints, prepared.expiresAt, prepared.passphrase, prepared.subkeyPassphrases);
            await this.applyDocument(updated, true);
            this.setStatus(`已延长 ${prepared.fingerprints.length} 把密钥的有效期：${prepared.fingerprints.map(fingerprint => this.formatFingerprint(fingerprint)).join('、')}。请在「导出」中下载完整私钥备份。`);
            this.playSuccessSound();
        } catch (error) {
            this.setError(error);
        } finally {
            this.finishOperation();
        }
    },

    // ---------------------------------------------------------------- export

    publicFileName(): string {
        return `${this.documentFingerprint}-pub.asc`;
    },

    backupFileName(): string {
        return `${this.documentFingerprint}-sec.asc`;
    },

    deviceFileName(): string {
        return `${this.documentFingerprint}-${sanitizeDeviceName(this.deviceName)}-device-sec.asc`;
    },

    selectedDeviceFingerprints(): string[] {
        return this.certificateRows
            .filter(row => this.deviceSelection[row.fingerprint] === true)
            .map(row => row.fingerprint);
    },

    deviceDisabled(): boolean {
        if (this.running || !this.hasDocument) return true;
        return !this.certificateRows.some(row => this.deviceSelection[row.fingerprint] === true && this.deviceReason(row) === '');
    },

    exportPublic(): void {
        if (this.running || !currentDocument) return;
        this.clearMessages();
        try {
            downloadFile(this.publicFileName(), armorPublicDocument(currentDocument));
            this.setStatus('已发起公钥下载。公钥导出不会代替完整私钥备份。');
        } catch (error) {
            this.setError(error);
        }
    },

    exportBackup(): void {
        if (this.running || !currentDocument) return;
        this.clearMessages();
        if (!this.backupAcknowledged) {
            this.setError('请先勾选确认：完整私钥备份包含当前证书的全部秘密材料。');
            return;
        }
        try {
            downloadFile(this.backupFileName(), armorKeyDocument(currentDocument));
            this.backupStarted = true;
            this.setStatus('已发起完整私钥备份下载，请在文件保存后点击「确认备份已保存」。');
        } catch (error) {
            this.setError(error);
        }
    },

    confirmBackupSaved(): void {
        if (!this.backupStarted) {
            this.setError('请先发起完整私钥备份下载。');
            return;
        }
        this.dirtyBackup = false;
        this.backupStarted = false;
        this.backupAcknowledged = false;
        this.syncBeforeUnload();
        this.setStatus('已确认当前证书的完整私钥备份已保存。');
    },

    prepareDeviceExport(): PreparedDevice {
        const document = currentDocument;
        if (!document) throw new Error('尚未加载证书。');
        const selected = this.certificateRows.filter(row => this.deviceSelection[row.fingerprint] === true);
        if (selected.length === 0) throw new Error('请选择至少一把要导出的子钥。');
        const rejected = selected.filter(row => this.deviceReason(row) !== '');
        if (rejected.length > 0) {
            throw new Error(`以下子钥不能用于设备导出：${rejected.map(row => `${this.formatFingerprint(row.fingerprint)}（${this.deviceReason(row)}）`).join('、')}。`);
        }
        const passphrases: Record<string, string> = {};
        for (const row of selected) {
            const passphrase = this.deviceSubkeyPassphrases[row.fingerprint];
            if (passphrase) passphrases[row.fingerprint] = passphrase;
        }
        return {
            document,
            fingerprints: selected.map(row => row.fingerprint),
            passphrases,
            protection: this.buildProtection(this.devicePassphrase, this.devicePassphraseConfirm, this.deviceAllowUnprotected),
        };
    },

    async exportDevice(): Promise<void> {
        if (this.running) return;
        this.clearMessages();
        let prepared: PreparedDevice;
        try {
            prepared = this.prepareDeviceExport();
        } catch (error) {
            this.setError(error);
            return;
        }
        this.startOperation(false);
        try {
            const armored = await exportDeviceKey(prepared.document, prepared.fingerprints, prepared.passphrases, prepared.protection);
            downloadFile(this.deviceFileName(), armored);
            this.setStatus(`已发起设备私钥下载，仅包含所选 ${prepared.fingerprints.length} 把子钥的秘密材料。完整私钥备份仍需单独下载。`);
        } catch (error) {
            this.setError(error);
        } finally {
            this.finishOperation();
        }
    },
};

createApp(app).mount();
