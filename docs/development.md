# Development guide

## Toolchain

- Node.js 24
- pnpm 10.11.0 (pinned via `packageManager` and the committed lockfile)
- GnuPG ≥ 2.4 for the lifecycle/time behavior tests
- A browser with WebGL2 integer framebuffer support for manual verification

The project uses pnpm patches (`patches/openpgp@6.3.0.patch`), so install with
pnpm rather than npm. If your pnpm refuses to switch to the pinned version,
install the pinned CLI explicitly, for example:

```sh
corepack prepare pnpm@10.11.0 --activate
# or
corepack pnpm install --frozen-lockfile
```

`pnpm install --frozen-lockfile` must be reproducible from a clean checkout.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Vite dev server on `127.0.0.1:5173` |
| `pnpm typecheck` | `vue-tsc --noEmit` over `src/**/*.ts` and `.vue` |
| `pnpm test` | Node test runner over `tests/*.test.ts` |
| `pnpm build` | Type-check, then production `vite build` |
| `pnpm preview` | Serve `dist/` on `127.0.0.1:4173` |

The shader minifier is optional. If `shader_minifier` is not on `PATH`, the
build prints a warning and leaves the shader unminified.

## Tests

`pnpm test` runs:

- `tests/time-window.test.ts` — DST-aware day math, clipping, epoch 0, expiry.
- `tests/key-lifecycle.test.ts` — real OpenPGP.js packet operations plus
  isolated temporary GnuPG keyrings: C-only primary, S/E bindings, historical
  packet preservation, renewal, device key secret isolation, failure atomicity.
- `tests/ui-*.test.ts` — pure UI modules: zh/en catalog parity, preference
  storage and normalization, difficulty/material math, formatting, error
  localization, and window helpers.

The GnuPG suites create `mkdtemp` directories with 0700 permissions, use
`--no-options --homedir`, pass passphrases through stdin or 0600 files, kill the
temporary `gpg-agent`, and remove the directory afterwards. They never read or
write `~/.gnupg`.

UI tests must not import Vue, `window`, `document`, or modules that touch
browser storage at import time. That is why `preferences-core.ts`,
`format.ts`, `difficulty.ts`, `window.ts`, and `i18n/translate.ts` are kept
separate from their reactive wrappers.

## Build and CSP

`pnpm build` runs `vue-tsc --noEmit` and `vite build`. The production HTML gets
a CSP via a small Vite plugin:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self'; media-src 'self' data:;
connect-src 'none'; worker-src 'self'; object-src 'none';
base-uri 'none'; form-action 'none'
```

The development server intentionally omits the CSP so HMR websockets continue to
work. `dist/` is self-contained; serving it does not require network access.

## Browser verification

The rewrite was verified with a headless Chrome driven over the DevTools
protocol against `vite preview`. The procedure is:

1. `pnpm run build && pnpm run preview -- --port 4173`
2. Open `http://127.0.0.1:4173/` in Chromium (software WebGL is enough for
   functional checks; it is not representative for speed).
3. Walk the full lifecycle: create a one-nibble-prefix test primary, add one
   signing and one encryption subkey, export a device key, renew the subkeys,
   download and confirm the full backup, re-import that backup.
4. Switch language and theme, open settings/help, and resize to 390 px width.
5. Check the console for exceptions, the Network panel for external hosts (only
   `127.0.0.1` is allowed), and `localStorage` for the preference entry only.

A temporary CDP script was used during the rewrite but is intentionally not
committed: it depends on a local Chrome binary and is not an assertion suite.
For repeatable automation, add a Playwright test that stubs `SearchBackend` and
use a separate real-GPU smoke job.

## Code conventions

- Keep the cryptographic engine free of Vue imports and presentation concerns.
- Add every new message to both catalogs; the parity test fails otherwise.
- Use semantic theme tokens in new components; do not introduce raw
  Catppuccin names outside `tokens.css`.
- Never put a `KeyDocument`, passphrase, or operation-owned secret into deep
  reactive state. Use `shallowRef`/`markRaw`, clear secrets in `finally`.
- Use `UiError`/`error message keys` for user-facing validation.
- Keep browser-only helpers in `src/ui/browser.ts` and keep tested modules pure.
- No external fonts, images, scripts, or network calls may be added to the
  runtime bundle.

## Branches and commits

- `develop` is the integration branch; `master` tracks upstream.
- Use `feat/…`, `fix/…`, and `docs/…` branches for distinct changes and merge
  them into `develop` when complete.
- Commits are Conventional Commits with an English title and a body covering
  *what*, *why*, and the *verification* that was actually run. Keep commits
  atomic; do not mix formatting-only or unrelated changes.
- Do not push to upstream. The fork's `origin` currently only has `master`;
  push a `develop` branch deliberately when publishing.

## CI

`.github/workflows/build.yml` is unchanged from upstream: it builds on pushes to
`master`, downloads `shader_minifier`, deploys `dist/` to GitHub Pages, and
uploads the bundle visualizer report. It does not run tests and does not cover
`develop`. Update the branch filters and add `pnpm test` before publishing this
frontend from a fork.

## Performance work

- Expected hashes for a prefix of length `n` is `16^n`.
- Expected key materials is `expectedHashes / windowLength`; each material is a
  fresh Ed25519 key generation. Short windows therefore dominate runtime.
- Candidate generation currently runs on the main thread. A worker-based
  candidate pool is the next optimization to evaluate; it would need a
  structured-clone boundary and must keep secret material out of the GPU.
- Always record the renderer (`gl.getParameter(UNMASKED_RENDERER_WEBGL)`) when
  comparing performance. SwiftShader results are functional only.
- Use the in-app benchmark to seed the measured rate, and treat time estimates
  as expectations rather than guarantees.
