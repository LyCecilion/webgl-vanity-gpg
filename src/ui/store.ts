import { computed, markRaw, reactive, shallowRef } from 'vue';
import { enums } from 'openpgp';
import type { AlgorithmInfo, PrivateKey, SignaturePacket, Subkey } from 'openpgp';
import { fullConfig } from '../openpgp-packets.ts';
import type { KeyDocument } from '../key-document.ts';
import { prefersReducedMotion } from './browser.ts';
import { friendlyError } from './errors.ts';
import type { FriendlyError } from './errors.ts';
import { translate } from './i18n/translate.ts';
import type { MessageKey } from './i18n/messages.ts';
import { preferences } from './preferences.ts';

export type KeyRole = 'primary' | 'signing' | 'encryption' | 'unknown';
export type SecretState = 'protected' | 'unprotected' | 'dummy' | 'unknown';

export type CertificateRow = {
    fingerprint: string;
    primary: boolean;
    role: KeyRole;
    algorithm: string;
    usage: string[];
    keyFlags: number[];
    createdMs: number;
    expirationMs: number | null;
    expirationKnown: boolean;
    expired: boolean;
    revoked: boolean;
    secret: SecretState;
    hasSecret: boolean;
};

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export type Toast = {
    id: number;
    kind: ToastKind;
    message: string;
    detail?: string;
};

export type OperationKind = 'create' | 'add' | 'renew' | 'import' | 'export' | 'device-export' | 'benchmark';

export type DialogName = 'create' | 'import' | 'add' | 'renew' | 'export' | 'settings' | 'help' | 'details' | 'result';

export type OperationProgress = {
    hashes: number;
    materials: number;
    elapsedMs: number;
    rate: number | null;
    expectedHashes: bigint | null;
};

export type LastRun = {
    kind: 'create' | 'add';
    fingerprint: string;
    fingerprints: string[];
    hashes: number;
    materials: number;
    elapsedMs: number;
    rate: number | null;
    expectedHashes: bigint | null;
};

type SecretPacketAccess = {
    isDummy(): boolean;
    isDecrypted(): boolean;
    algorithm: number;
};

// ------------------------------------------------------------------ document

/**
 * The certificate is deliberately `markRaw`ed and kept in a `shallowRef`: Vue's
 * deep proxy would wrap OpenPGP.js packet objects, break their methods, and leak
 * secret material into reactive state.
 */
export const currentDocument = shallowRef<KeyDocument | undefined>(undefined);

export const certificate = reactive({
    fingerprint: '',
    userIDs: [] as string[],
    rows: [] as CertificateRow[],
    dirtyBackup: false,
    backupStarted: false,
    backupAcknowledged: false,
    addBlocked: [] as MessageKey[],
    renewBlocked: [] as MessageKey[],
});

export const hasDocument = computed(() => certificate.fingerprint !== '');

export const operation = reactive({
    active: false,
    kind: null as OperationKind | null,
    waiting: false,
    cancellable: false,
    titleKey: 'progress.wait' as MessageKey,
    roleKey: null as MessageKey | null,
    current: 0,
    total: 0,
    windowText: '',
    progress: {
        hashes: 0,
        materials: 0,
        elapsedMs: 0,
        rate: null as number | null,
        expectedHashes: null as bigint | null,
    } satisfies OperationProgress,
});

export const lastRun = reactive<LastRun>({
    kind: 'create',
    fingerprint: '',
    fingerprints: [],
    hashes: 0,
    materials: 0,
    elapsedMs: 0,
    rate: null,
    expectedHashes: null,
});

export const ui = reactive({
    dialog: null as DialogName | null,
    detailFingerprint: '' as string,
    exportTab: 'public' as 'public' | 'backup' | 'device',
    devicePreselect: [] as string[],
    renewPreselect: [] as string[],
});

let closeTimer: number | undefined;
let closeSequence = 0;

export function openDialog(dialog: DialogName): void {
    // A pending animated close must not clear the dialog that is opening next.
    closeSequence++;
    if (closeTimer !== undefined) {
        window.clearTimeout(closeTimer);
        closeTimer = undefined;
    }
    ui.dialog = dialog;
}

/**
 * Close the active dialog with a short exit animation. Native <dialog> stays in
 * the top layer while the closing class plays; the component unmounts after the
 * animation so BaseDialog can call dialog.close().
 */
export function closeDialog(): void {
    if (ui.dialog === null) return;
    const dialog = document.querySelector<HTMLDialogElement>('dialog.dialog[open]');
    const finish = (): void => {
        ui.dialog = null;
        ui.detailFingerprint = '';
    };
    if (!dialog || prefersReducedMotion()) {
        finish();
        return;
    }
    const sequence = ++closeSequence;
    dialog.classList.add('dialog--closing');
    window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
        closeTimer = undefined;
        if (sequence !== closeSequence) return;
        dialog.classList.remove('dialog--closing');
        finish();
    }, 170);
}

export function openExportDialog(tab: 'public' | 'backup' | 'device', preselect: readonly string[] = []): void {
    ui.exportTab = tab;
    ui.devicePreselect = [...preselect];
    ui.dialog = 'export';
}

export function openRenewDialog(preselect: readonly string[] = []): void {
    ui.renewPreselect = [...preselect];
    ui.dialog = 'renew';
}

export const toasts = reactive<Toast[]>([]);
let toastId = 0;

export function pushToast(kind: ToastKind, message: string, detail?: string): void {
    const id = ++toastId;
    toasts.push({ id, kind, message, detail });
    const timeout = kind === 'error' ? 10_000 : 4_500;
    window.setTimeout(() => dismissToast(id), timeout);
}

export function dismissToast(id: number): void {
    const index = toasts.findIndex(toast => toast.id === id);
    if (index >= 0) toasts.splice(index, 1);
}

export function toastError(error: unknown): FriendlyError {
    const friendly = friendlyError(error, preferences.locale);
    pushToast('error', friendly.message, friendly.detail);
    return friendly;
}

export function toastSuccess(message: string): void {
    pushToast('success', message);
}

// ------------------------------------------------------------------ confirmation

type Confirmation = {
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
    danger: boolean;
};

export const confirmation = reactive<Confirmation>({
    open: false,
    title: '',
    message: '',
    confirmLabel: '',
    cancelLabel: '',
    danger: false,
});

let pendingConfirmation: ((value: boolean) => void) | undefined;

/** Promise-based confirmation dialog; avoids blocking `window.confirm`. */
export function askConfirmation(options: {
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
    danger?: boolean;
}): Promise<boolean> {
    if (pendingConfirmation) pendingConfirmation(false);
    Object.assign(confirmation, { ...options, danger: options.danger ?? true, open: true });
    return new Promise<boolean>((resolve) => {
        pendingConfirmation = resolve;
    });
}

export function resolveConfirmation(value: boolean): void {
    confirmation.open = false;
    const resolve = pendingConfirmation;
    pendingConfirmation = undefined;
    resolve?.(value);
}

// ------------------------------------------------------------------ operation control

let abortController: AbortController | undefined;

export class CancelledError extends Error {
    constructor() {
        super('Operation cancelled.');
        this.name = 'CancelledError';
    }
}

export function startOperation(options: {
    kind: OperationKind;
    titleKey: MessageKey;
    cancellable: boolean;
    waiting?: boolean;
    total?: number;
    windowText?: string;
}): void {
    operation.active = true;
    operation.kind = options.kind;
    operation.waiting = options.waiting ?? false;
    operation.cancellable = options.cancellable;
    operation.titleKey = options.titleKey;
    operation.roleKey = null;
    operation.current = 0;
    operation.total = options.total ?? 0;
    operation.windowText = options.windowText ?? '';
    operation.progress = { hashes: 0, materials: 0, elapsedMs: 0, rate: null, expectedHashes: null };
    abortController = options.cancellable ? new AbortController() : undefined;
}

export function finishOperation(): void {
    operation.active = false;
    operation.waiting = false;
    operation.cancellable = false;
    abortController = undefined;
}

export function stopOperation(): void {
    abortController?.abort();
}

export function operationSignal(): AbortSignal | undefined {
    return abortController?.signal;
}

export function throwIfCancelled(): void {
    if (abortController?.signal.aborted) throw new CancelledError();
}

export function updateProgress(patch: Partial<OperationProgress>): void {
    Object.assign(operation.progress, patch);
}

export function setOperationTarget(current: number, total: number, roleKey: MessageKey): void {
    operation.current = current;
    operation.total = total;
    operation.roleKey = roleKey;
}

// ------------------------------------------------------------------ certificate inspection

function secretAccess(packet: unknown): SecretPacketAccess {
    return packet as SecretPacketAccess;
}

function secretState(packet: SecretPacketAccess): SecretState {
    if (packet.isDummy()) return 'dummy';
    try {
        return packet.isDecrypted() ? 'unprotected' : 'protected';
    } catch {
        return 'unknown';
    }
}

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
        case enums.publicKey.eddsaLegacy:
            return ['S'];
        case enums.publicKey.ecdh:
            return ['E'];
        default:
            return [];
    }
}

function usageCodes(primary: boolean, algorithm: number, flags: readonly number[]): string[] {
    const codes: string[] = [];
    if (flags.includes(enums.keyFlags.certifyKeys)) codes.push('C');
    if (flags.includes(enums.keyFlags.signData)) codes.push('S');
    if (flags.includes(enums.keyFlags.encryptCommunication) || flags.includes(enums.keyFlags.encryptStorage)) codes.push('E');
    if (flags.includes(enums.keyFlags.authentication)) codes.push('A');
    if (codes.length > 0) return codes;
    if (primary) return ['C'];
    return algorithmCapabilities(algorithm);
}

function roleOf(primary: boolean, usage: readonly string[]): KeyRole {
    if (primary) return 'primary';
    if (usage.includes('S')) return 'signing';
    if (usage.includes('E')) return 'encryption';
    return 'unknown';
}

function algorithmText(info: AlgorithmInfo): string {
    const detail = info.bits ? `${info.bits} bit` : info.curve ? `${info.curve}` : '';
    return detail ? `${info.algorithm} (${detail})` : info.algorithm;
}

/** Newest currently valid self-certification flags, never future or unverified metadata. */
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
            continue;
        }
        if (!newest || signature.created > newest.created!) newest = signature;
    }
    return Array.from(newest?.keyFlags ?? []);
}

async function expirationOf(lookup: Promise<Date | number | null>): Promise<{ ms: number | null; known: boolean }> {
    const value = await lookup.catch(() => null);
    if (value instanceof Date) return { ms: value.getTime(), known: true };
    return { ms: null, known: value !== null };
}

export const addBlocked = computed<MessageKey[]>(() => {
    const row = certificate.rows[0];
    if (!row) return ['dash.blocked.noDocument'];
    const reasons: MessageKey[] = [];
    if (!row.hasSecret) reasons.push('dash.blocked.noSecret');
    if (row.revoked) reasons.push('dash.blocked.revoked');
    if (row.expired) reasons.push('dash.blocked.expired');
    if (!row.expirationKnown) reasons.push('dash.blocked.noSelfCert');
    return reasons;
});

export const renewBlocked = computed<MessageKey[]>(() => {
    const row = certificate.rows[0];
    if (!row) return ['dash.blocked.noDocument'];
    const reasons: MessageKey[] = [];
    if (!row.hasSecret) reasons.push('dash.blocked.noSecret');
    if (row.revoked) reasons.push('dash.blocked.revoked');
    if (!row.expirationKnown) reasons.push('dash.blocked.noSelfCert');
    return reasons;
});

export function renewReason(row: CertificateRow): MessageKey | null {
    if (row.revoked) return 'renew.reason.revoked';
    if (!row.expirationKnown) return 'renew.reason.invalid';
    if (row.expirationMs === null) return 'renew.reason.never';
    if (!row.primary && row.role === 'unknown') return 'renew.reason.unknown';
    return null;
}

export function deviceEligibility(row: CertificateRow): MessageKey | null {
    if (row.primary) return 'export.device.primary';
    if (!row.hasSecret) return 'export.device.reasonNoSecret';
    if (row.revoked) return 'export.device.reasonRevoked';
    if (row.expired) return 'export.device.reasonExpired';
    if (!row.expirationKnown) return 'export.device.reasonInvalid';
    return null;
}

export function findRow(fingerprint: string): CertificateRow | undefined {
    return certificate.rows.find(row => row.fingerprint === fingerprint);
}

async function buildRows(document: KeyDocument): Promise<CertificateRow[]> {
    const key = document.key;
    const now = new Date();
    const rows: CertificateRow[] = [];

    const primaryPacket = secretAccess(key.keyPacket);
    const primaryExpiration = await expirationOf(key.getExpirationTime(undefined, fullConfig));
    const primaryFlags = await verifiedKeyFlags(key, now);
    const primaryUsage = usageCodes(true, primaryPacket.algorithm, primaryFlags);
    rows.push({
        fingerprint: key.getFingerprint().toUpperCase(),
        primary: true,
        role: 'primary',
        algorithm: algorithmText(key.getAlgorithmInfo()),
        usage: primaryUsage,
        keyFlags: primaryFlags,
        createdMs: key.getCreationTime().getTime(),
        expirationMs: primaryExpiration.ms,
        expirationKnown: primaryExpiration.known,
        expired: primaryExpiration.ms !== null && primaryExpiration.ms <= now.getTime(),
        revoked: await key.isRevoked(undefined, undefined, now, fullConfig).catch(() => false),
        secret: secretState(primaryPacket),
        hasSecret: !primaryPacket.isDummy(),
    });

    for (const subkey of key.subkeys) {
        const packet = secretAccess(subkey.keyPacket);
        const flags = await verifiedKeyFlags(key, now, subkey);
        const usage = usageCodes(false, packet.algorithm, flags);
        const expiration = await expirationOf(subkey.getExpirationTime(now, fullConfig));
        rows.push({
            fingerprint: subkey.getFingerprint().toUpperCase(),
            primary: false,
            role: roleOf(false, usage),
            algorithm: algorithmText(subkey.getAlgorithmInfo()),
            usage,
            keyFlags: flags,
            createdMs: subkey.getCreationTime().getTime(),
            expirationMs: expiration.ms,
            expirationKnown: expiration.known,
            expired: expiration.ms !== null && expiration.ms <= now.getTime(),
            revoked: await subkey.isRevoked(subkey.bindingSignatures[0], key.keyPacket, now, fullConfig).catch(() => false),
            secret: secretState(packet),
            hasSecret: !packet.isDummy(),
        });
    }
    return rows;
}

export async function refreshCertificate(): Promise<void> {
    const document = currentDocument.value;
    if (!document) {
        certificate.fingerprint = '';
        certificate.userIDs = [];
        certificate.rows = [];
        return;
    }
    certificate.fingerprint = document.key.getFingerprint().toUpperCase();
    certificate.userIDs = document.key.getUserIDs();
    certificate.rows = await buildRows(document);
}

export async function applyDocument(document: KeyDocument, dirtyBackup: boolean): Promise<void> {
    currentDocument.value = markRaw(document);
    certificate.dirtyBackup = dirtyBackup;
    certificate.backupStarted = false;
    certificate.backupAcknowledged = false;
    await refreshCertificate();
}

export function clearDocument(): void {
    currentDocument.value = undefined;
    certificate.fingerprint = '';
    certificate.userIDs = [];
    certificate.rows = [];
    certificate.dirtyBackup = false;
    certificate.backupStarted = false;
    certificate.backupAcknowledged = false;
}

export function markBackupSaved(): void {
    certificate.dirtyBackup = false;
    certificate.backupStarted = false;
    certificate.backupAcknowledged = false;
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
    return translate(preferences.locale, key, params);
}

/** Used by the beforeunload guard and the backup banner. */
export const backupNeedsAttention = computed(() => hasDocument.value && certificate.dirtyBackup);
