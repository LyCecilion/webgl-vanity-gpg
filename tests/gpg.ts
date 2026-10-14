import { mkdtemp, chmod, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { TestContext } from 'node:test';

export async function keyring(t: TestContext) {
    const home = await mkdtemp(join(tmpdir(), 'vanity-gpg-test-'));
    await chmod(home, 0o700);
    t.after(async () => {
        spawnSync('gpgconf', ['--homedir', home, '--kill', 'gpg-agent']);
        await rm(home, { recursive: true, force: true });
    });
    function gpg(args: string[], input?: string | Uint8Array) {
        const result = spawnSync('gpg', ['--no-options', '--homedir', home, '--batch', '--no-tty', ...args], { input, encoding: 'utf8' });
        if (result.error) throw result.error;
        return result;
    }
    async function file(name: string, value: string | Uint8Array) {
        const path = join(home, name);
        await writeFile(path, value, { mode: 0o600 });
        return path;
    }
    return { home, gpg, file };
}
