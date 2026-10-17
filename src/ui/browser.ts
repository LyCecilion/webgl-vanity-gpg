/** Small browser-only helpers. They are never imported by the Node test suites. */

export function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    // A fresh view guarantees an ArrayBuffer-backed source for SubtleCrypto.
    const source = new Uint8Array(bytes);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', source));
    return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function downloadText(filename: string, text: string, mime = 'application/pgp-keys; charset=utf-8'): void {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.click();
    // The browser reads the blob asynchronously, so release the URL on a later task.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // Clipboard API is unavailable outside secure contexts; fall back to a selection.
        try {
            const area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            const copied = document.execCommand('copy');
            area.remove();
            return copied;
        } catch {
            return false;
        }
    }
}

export async function readFileText(file: File): Promise<string> {
    return file.text();
}
