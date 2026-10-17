import type { UserID } from 'openpgp';
import { exportDeviceKey as buildDeviceKey } from '../device-export.ts';
import { armorKeyDocument, armorPublicDocument, importKeyDocument } from '../key-document.ts';
import type { KeyDocument } from '../key-document.ts';
import { appendSubkeys, createPrimaryDocument, renewKey } from '../key-lifecycle.ts';
import type { Protection } from '../key-lifecycle.ts';
import { rawPacket } from '../openpgp-packets.ts';
import type { KeyRole as EngineKeyRole, VanityCandidate } from '../openpgp-packets.ts';
import type { SearchWindow } from '../time-window.ts';
import { searchVanityPacket } from '../vanity-key.ts';
import type { SearchProgress, VanitySearchOptions } from '../vanity-key.ts';
import tadaData from '../tada.ogg?inline';
import { downloadText, sha256Hex } from './browser.ts';
import { expectedHashes } from './difficulty.ts';
import { translate } from './i18n/translate.ts';
import { sanitizeFileName } from './format.ts';
import { preferences } from './preferences.ts';
import {
    applyDocument,
    certificate,
    CancelledError,
    clearDocument,
    currentDocument,
    finishOperation,
    lastRun,
    markBackupSaved,
    openDialog,
    operation,
    operationSignal,
    pushToast,
    setOperationTarget,
    startOperation,
    stopOperation,
    throwIfCancelled,
    toastError,
    updateProgress,
} from './store.ts';

export type SearchBackend = (options: VanitySearchOptions) => Promise<VanityCandidate | undefined>;

let searchBackend: SearchBackend = searchVanityPacket;
const tada = new Audio(tadaData);

function playSuccessSound(): void {
    if (!preferences.soundEnabled) return;
    tada.currentTime = 0;
    void tada.play().catch(() => undefined);
}

/** Test seam: the UI smoke tests can substitute a deterministic search. */
export function setSearchBackend(backend: SearchBackend | undefined): void {
    searchBackend = backend ?? searchVanityPacket;
}

export type CreateRequest = {
    userIDs: UserID[];
    prefix: string;
    window: SearchWindow;
    windowText: string;
    expiresAt: Date | null;
    protection: Protection;
    threads: number;
    iterations: number;
};

export type AddRequest = {
    signing: number;
    encryption: number;
    prefix: string;
    window: SearchWindow;
    windowText: string;
    expiresAt: Date | null;
    primaryPassphrase: string;
    protection: Protection;
    threads: number;
    iterations: number;
};

export type RenewRequest = {
    fingerprints: string[];
    expiresAt: Date | null;
    primaryPassphrase: string;
    subkeyPassphrases: Record<string, string>;
};

export type DeviceExportRequest = {
    fingerprints: string[];
    passphrases: Record<string, string>;
    deviceName: string;
    protection: Protection;
};

type Totals = { hashes: number; materials: number; elapsedMs: number };

function t(key: Parameters<typeof translate>[1], params?: Record<string, string | number>): string {
    return translate(preferences.locale, key, params);
}

function recordMeasuredRate(totals: Totals): void {
    if (totals.hashes < 1000 || totals.elapsedMs < 100) return;
    const rate = totals.hashes / (totals.elapsedMs / 1000);
    if (Number.isFinite(rate) && rate > 0) preferences.measuredRate = Math.round(rate);
}

function clearCandidates(candidates: readonly VanityCandidate[], unpublished?: KeyDocument): void {
    for (const candidate of candidates) {
        const packet = rawPacket(candidate.packet);
        if (packet.isDecrypted()) packet.clearPrivateParams();
    }
    if (unpublished && unpublished !== currentDocument.value) {
        const primary = rawPacket(unpublished.key.keyPacket);
        if (primary.isDecrypted()) primary.clearPrivateParams();
        for (const subkey of unpublished.key.subkeys) {
            const packet = rawPacket(subkey.keyPacket);
            if (packet.isDecrypted()) packet.clearPrivateParams();
        }
    }
}

/** Search one target while publishing throttled progress into the operation store. */
async function searchTarget(
    role: EngineKeyRole,
    prefix: string,
    window: SearchWindow,
    threads: number,
    iterations: number,
    targetIndex: number,
    targetTotal: number,
    roleKey: Parameters<typeof setOperationTarget>[2],
    totals: Totals,
): Promise<VanityCandidate> {
    const signal = operationSignal();
    if (!signal) throw new Error('The search has no cancellation signal.');
    // The operation may search several targets (for example two signing
    // subkeys). The overlay reports aggregate attempts, so probability must be
    // measured against the aggregate expected hash count.
    const expected = expectedHashes(prefix.length) * BigInt(Math.max(1, targetTotal));
    const baseHashes = totals.hashes;
    const baseMaterials = totals.materials;
    const baseElapsed = totals.elapsedMs;
    let latest: SearchProgress = { hashes: 0, materials: 0, elapsedMs: 0 };
    let lastFlush = 0;

    setOperationTarget(targetIndex, targetTotal, roleKey);
    const candidate = await searchBackend({
        role,
        prefix,
        window,
        threads,
        iterations,
        signal,
        onProgress: (progress) => {
            latest = progress;
            const now = performance.now();
            if (now - lastFlush < 100) return;
            lastFlush = now;
            updateProgress({
                hashes: baseHashes + progress.hashes,
                materials: baseMaterials + progress.materials,
                elapsedMs: baseElapsed + progress.elapsedMs,
                rate: progress.elapsedMs > 0 ? progress.hashes / (progress.elapsedMs / 1000) : null,
                expectedHashes: expected,
            });
        },
    });
    if (!candidate) throw new CancelledError();
    totals.hashes = baseHashes + latest.hashes;
    totals.materials = baseMaterials + latest.materials;
    totals.elapsedMs = baseElapsed + latest.elapsedMs;
    updateProgress({
        hashes: totals.hashes,
        materials: totals.materials,
        elapsedMs: totals.elapsedMs,
        rate: totals.elapsedMs > 0 ? totals.hashes / (totals.elapsedMs / 1000) : null,
        expectedHashes: expected,
    });
    return candidate;
}

function publishRun(kind: 'create' | 'add', fingerprint: string, fingerprints: string[], totals: Totals, expected: bigint): void {
    lastRun.kind = kind;
    lastRun.fingerprint = fingerprint;
    lastRun.fingerprints = fingerprints;
    lastRun.hashes = totals.hashes;
    lastRun.materials = totals.materials;
    lastRun.elapsedMs = totals.elapsedMs;
    lastRun.rate = totals.elapsedMs > 0 ? totals.hashes / (totals.elapsedMs / 1000) : null;
    lastRun.expectedHashes = expected;
    openDialog('result');
}

function ensureIdle(): boolean {
    if (!operation.active) return true;
    pushToast('warning', t('error.busy'));
    return false;
}

export async function createPrimary(request: CreateRequest): Promise<void> {
    if (!ensureIdle()) return;
    const expected = expectedHashes(request.prefix.length);
    const totals: Totals = { hashes: 0, materials: 0, elapsedMs: 0 };
    const candidates: VanityCandidate[] = [];
    let document: KeyDocument | undefined;
    startOperation({
        kind: 'create',
        titleKey: 'progress.create',
        cancellable: true,
        total: 1,
        windowText: request.windowText,
    });
    try {
        const candidate = await searchTarget('primary', request.prefix, request.window, request.threads, request.iterations, 1, 1, 'create.searchRole', totals);
        candidates.push(candidate);
        throwIfCancelled();
        document = await createPrimaryDocument(candidate, request.userIDs, request.expiresAt, request.protection);
        throwIfCancelled();
        await applyDocument(document, true);
        recordMeasuredRate(totals);
        publishRun('create', document.key.getFingerprint().toUpperCase(), [], totals, expected);
        playSuccessSound();
        pushToast('success', t('toast.created'));
    } catch (error) {
        if (error instanceof CancelledError) pushToast('info', t('progress.cancelled'));
        else toastError(error);
    } finally {
        clearCandidates(candidates, document);
        finishOperation();
    }
}

export async function addSubkeys(request: AddRequest): Promise<void> {
    if (!ensureIdle()) return;
    const document = currentDocument.value;
    if (!document) {
        pushToast('error', t('dash.blocked.noDocument'));
        return;
    }
    const total = request.signing + request.encryption;
    const expected = expectedHashes(request.prefix.length);
    const totals: Totals = { hashes: 0, materials: 0, elapsedMs: 0 };
    const candidates: VanityCandidate[] = [];
    let updated: KeyDocument | undefined;
    startOperation({
        kind: 'add',
        titleKey: 'progress.add',
        cancellable: true,
        total,
        windowText: request.windowText,
    });
    try {
        for (let index = 0; index < request.signing; index++) {
            candidates.push(await searchTarget('signing', request.prefix, request.window, request.threads, request.iterations, index + 1, total, 'add.search.signing', totals));
        }
        for (let index = 0; index < request.encryption; index++) {
            candidates.push(await searchTarget('encryption', request.prefix, request.window, request.threads, request.iterations, request.signing + index + 1, total, 'add.search.encryption', totals));
        }
        throwIfCancelled();
        updated = await appendSubkeys(document, candidates, request.expiresAt, request.primaryPassphrase, request.protection);
        throwIfCancelled();
        await applyDocument(updated, true);
        recordMeasuredRate(totals);
        publishRun('add', updated.key.getFingerprint().toUpperCase(), candidates.map(candidate => candidate.fingerprint.toUpperCase()), totals, expected);
        playSuccessSound();
        pushToast('success', t('toast.added'));
    } catch (error) {
        if (error instanceof CancelledError) pushToast('info', t('progress.cancelled'));
        else toastError(error);
    } finally {
        clearCandidates(candidates, updated);
        finishOperation();
    }
}

export async function renewKeys(request: RenewRequest): Promise<void> {
    if (!ensureIdle()) return;
    const document = currentDocument.value;
    if (!document) {
        pushToast('error', t('dash.blocked.noDocument'));
        return;
    }
    startOperation({ kind: 'renew', titleKey: 'progress.renew', cancellable: false, waiting: true });
    try {
        const updated = await renewKey(document, request.fingerprints, request.expiresAt, request.primaryPassphrase, request.subkeyPassphrases);
        await applyDocument(updated, true);
        playSuccessSound();
        pushToast('success', t('toast.renewed'));
    } catch (error) {
        toastError(error);
    } finally {
        finishOperation();
    }
}

export async function previewImport(armored: string): Promise<KeyDocument> {
    return importKeyDocument(armored);
}

export async function commitImport(document: KeyDocument): Promise<void> {
    if (!ensureIdle()) return;
    await applyDocument(document, false);
    const primary = document.key.keyPacket;
    const primarySecret = primary as unknown as { isDummy(): boolean };
    if (primarySecret.isDummy()) pushToast('info', t('toast.subkeysLoaded'));
    else pushToast('success', t('toast.imported'));
}

export function clearCertificate(): void {
    clearDocument();
    pushToast('info', t('toast.cleared'));
}

export function publicKeyText(): string {
    const document = currentDocument.value;
    if (!document) throw new Error('No certificate loaded.');
    return armorPublicDocument(document);
}

export function backupText(): string {
    const document = currentDocument.value;
    if (!document) throw new Error('No certificate loaded.');
    return armorKeyDocument(document);
}

export async function exportPublicKey(): Promise<void> {
    if (!ensureIdle()) return;
    try {
        const document = currentDocument.value;
        if (!document) throw new Error('No certificate loaded.');
        const filename = `${document.key.getFingerprint().toUpperCase()}-pub.asc`;
        downloadText(filename, armorPublicDocument(document));
        pushToast('success', t('toast.exported'));
    } catch (error) {
        toastError(error);
    }
}

export async function exportBackup(copyOnly = false): Promise<{ checksum: string } | undefined> {
    if (!ensureIdle()) return undefined;
    try {
        const document = currentDocument.value;
        if (!document) throw new Error('No certificate loaded.');
        const armored = armorKeyDocument(document);
        const checksum = await sha256Hex(armored);
        if (!copyOnly) {
            const filename = `${document.key.getFingerprint().toUpperCase()}-sec.asc`;
            downloadText(filename, armored);
            certificate.backupStarted = true;
            pushToast('success', t('toast.backupStarted'));
        }
        return { checksum };
    } catch (error) {
        toastError(error);
        return undefined;
    }
}

export function confirmBackupSaved(): void {
    if (!certificate.backupStarted) return;
    markBackupSaved();
    pushToast('success', t('toast.backupConfirmed'));
}

export async function exportDevice(request: DeviceExportRequest): Promise<{ filename: string; checksum: string } | undefined> {
    if (!ensureIdle()) return undefined;
    const document = currentDocument.value;
    if (!document) {
        pushToast('error', t('dash.blocked.noDocument'));
        return undefined;
    }
    startOperation({ kind: 'device-export', titleKey: 'progress.export', cancellable: false, waiting: true });
    try {
        const armored = await buildDeviceKey(document, request.fingerprints, request.passphrases, request.protection);
        const checksum = await sha256Hex(armored);
        const filename = `${document.key.getFingerprint().toUpperCase()}-${sanitizeFileName(request.deviceName)}-device-sec.asc`;
        downloadText(filename, armored);
        pushToast('success', t('export.device.success', { filename }));
        return { filename, checksum };
    } catch (error) {
        toastError(error);
        return undefined;
    } finally {
        finishOperation();
    }
}

/**
 * Measure the actual GPU hash rate with an impossible prefix and a short abort.
 * The result is stored as a non-sensitive preference and used for time estimates.
 */
export async function benchmarkGpu(threads: number, iterations: number, durationMs = 900): Promise<number | undefined> {
    if (!ensureIdle()) return undefined;
    if (typeof OffscreenCanvas === 'undefined') return undefined;
    const now = Math.floor(Date.now() / 1000);
    const controller = new AbortController();
    let hashes = 0;
    let elapsedMs = 0;
    let latest: SearchProgress = { hashes: 0, materials: 0, elapsedMs: 0 };
    const timer = window.setTimeout(() => controller.abort(), durationMs);
    try {
        await searchVanityPacket({
            role: 'primary',
            prefix: 'F'.repeat(40),
            window: { start: now - 3600, end: now },
            threads,
            iterations,
            signal: controller.signal,
            onProgress: (progress) => {
                latest = progress;
            },
        });
    } catch {
        // An aborted benchmark is expected; the collected progress is still valid.
    } finally {
        window.clearTimeout(timer);
        hashes = latest.hashes;
        elapsedMs = latest.elapsedMs;
    }
    if (hashes <= 0 || elapsedMs <= 0) return undefined;
    const rate = hashes / (elapsedMs / 1000);
    if (!Number.isFinite(rate) || rate <= 0) return undefined;
    preferences.measuredRate = Math.round(rate);
    return preferences.measuredRate;
}

export { stopOperation };
