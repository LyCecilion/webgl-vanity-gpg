# Architecture

## Repository layout

| Path | Role |
| --- | --- |
| `src/vanity-key.ts` | GPU vanity search: raw key-packet generation, shader setup, batching, cancellation, verification |
| `src/fshader.glsl`, `src/vshader.glsl` | WebGL2 SHA-1 search shader |
| `src/openpgp-packets.ts` | Raw OpenPGP.js packet constructors/signer and the shared full config |
| `src/key-document.ts` | Lossless packet framing, import/armor, public export, packet edits |
| `src/key-lifecycle.ts` | Create primary, append subkeys, renew expirations |
| `src/device-export.ts` | Device key with real secrets only for selected subkeys |
| `src/time-window.ts` | Frozen creation-time windows, DST-aware day math, expiration dates |
| `src/main.ts` | Vue bootstrap: theme, locale, mount |
| `src/ui/` | Vue 3 presentation layer (see below) |
| `tests/*.test.ts` | Node test-runner suites; engine suites use real GnuPG keyrings |
| `patches/openpgp@6.3.0.patch` | The only remaining pnpm patch (TypeScript export fix) |

The cryptographic engine has no dependency on Vue. `src/ui/` calls it through
adapters and never re-implements signing or packet parsing.

## Engine layer

### `KeyDocument` is the source of truth

OpenPGP.js reshapes keys while parsing: unknown packets may be dropped, packet
headers and ordering may change, and `key.armor()` is therefore not a lossless
export. The engine keeps:

```ts
type KeyDocument = {
    bytes: Uint8Array;      // exact imported/created bytes, authoritative
    frames: PacketFrame[];  // framing offsets of every packet
    key: PrivateKey;        // parsed copy, only for validation and signing
};
```

- `scanPacketFrames` implements the RFC 9580 §4.2 old/new length encodings,
  partial chains, and truncated-packet rejection.
- Append and renewal operations insert new packets at block boundaries and
  copy every existing frame byte for byte. Unknown non-critical packets,
  revocations, third-party certifications, and historical signatures survive.
- Legacy old-format EOF packets are normalized only in their header length when
  appending, preserving the body.
- `armorPublicDocument` replaces secret frames with public packet bodies and
  re-scans the result to refuse accidental secret leakage.
- `loadKeyDocument` accepts only a v4 Ed25519 legacy primary key; import rejects
  public-only blocks, multiple primaries, mixed public/secret packets, and
  malformed framing.

### Search pipeline (`vanity-key.ts`)

1. Generate one unbound `SecretKeyPacket`/`SecretSubkeyPacket` (Ed25519 or
   Curve25519 ECDH) with its creation time set to the window end.
2. Compute the SHA-1 input with `writeForHash(4)`, pad it for SHA-1, and upload
   it as big-endian words. The creation-time word is the only changing word in
   the shader.
3. Run one self-check with the CPU-known full fingerprint over a single second,
   then switch to the requested prefix and enumerate the frozen window
   downwards in batches.
4. Read back `[foundFlag, timestamp, attempts, 0]`. A hit is accepted only after
   `computeFingerprintAndKeyID`, an independent `crypto.subtle.digest('SHA-1')`
   comparison, and a window bounds check.
5. Cancellation is checked per batch, the event loop yields after 16 ms of busy
   time, and all GPU resources are released in `finally`. Secret material is
   cleared for exhausted materials and unpublished candidates. There is no CPU
   fallback for search.

### Lifecycle operations

- `createPrimaryDocument`: one certification-only primary key plus one
  self-certification per user ID. Signature preferences are limited to
  algorithms GnuPG supports.
- `appendSubkeys`: signing subkeys carry a cross-certification; encryption
  subkeys carry a binding signed by the primary. The primary must be currently
  valid. Nothing is published unless every binding succeeds.
- `renewKey`: creates replacement signatures while copying only re-verifiable
  semantic fields. It never shortens a lifetime, revives a revoked key, or
  claims unknown critical metadata.
- `exportDeviceKey`: parses an independent copy, makes the primary and
  unselected subkeys GNU dummy packets, re-encrypts selected secrets under the
  new device passphrase, and keeps the complete public certificate.

## Frontend layer

### Modules

| File | Responsibility |
| --- | --- |
| `src/ui/store.ts` | Session certificate (`shallowRef` + `markRaw`), derived key rows, backup state, operation/UI/dialog state, toasts, promise-based confirmation |
| `src/ui/operations.ts` | Adapters over the engine, `SearchBackend` seam for tests, operation lifecycle, progress reporting, exports, benchmark |
| `src/ui/preferences-core.ts` | Pure preference schema, validation, storage codec, compute presets |
| `src/ui/preferences.ts` | Reactive singleton, browser storage, reset |
| `src/ui/theme.ts` | Catppuccin flavor resolution and `data-theme` application |
| `src/ui/i18n/` | Typed zh-CN/en catalogs, interpolation, locale detection, composable |
| `src/ui/format.ts`, `difficulty.ts`, `window.ts`, `errors.ts`, `validation.ts`, `browser.ts` | Pure formatting, difficulty math, window helpers, error localization, validation, clipboard/downloads |
| `src/ui/components/` | Vue SFCs for the shell, dashboard, wizards, dialogs, and shared fields |
| `src/ui/styles/` | Design tokens and the single application stylesheet |

### State and operation flow

- `currentDocument` is a `shallowRef` holding a `markRaw`ed `KeyDocument`.
  Deep reactivity would proxy OpenPGP.js packet objects and leak secrets into
  reactive state.
- `certificate.rows` contains plain display rows only (fingerprints, usage,
  timestamps, expiration, secret state, revocation).
- A single `operation` object drives the modal overlay and guards against
  concurrent work. `operations.ts` exposes `ensureIdle()` for every public
  action.
- Wizard components validate their step, resolve the frozen window and expiry,
  then close themselves and start a module-level operation. The result sheet or
  dashboard observes the published document.
- Failed or cancelled operations never publish; candidates and unlocked secret
  material are cleared in `finally`.
- The `SearchBackend` indirection allows a deterministic fake search in UI
  tests or future browser automation.

### Backup state

`dirtyBackup` is set when a document is created, appended, or renewed. Downloading
the full backup sets `backupStarted`; only explicit confirmation clears both.
The top bar badge, dashboard banner, and `beforeunload` listener derive from that
state. Importing a file marks the document as already backed up. Device-key
imports additionally show a *Device key* badge because no full backup can be
produced from them.

### Build and CSP

`vite.config.ts` uses `@vitejs/plugin-vue`, an optional shader minifier, the
bundle visualizer, and a production-only HTML plugin that injects:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self'; media-src 'self' data:;
connect-src 'none'; worker-src 'self'; object-src 'none';
base-uri 'none'; form-action 'none'
```

The development server intentionally does not receive this CSP because HMR
needs websockets. `vite preview` and `dev` bind to `127.0.0.1`.

## Tests

- Engine suites (`tests/key-lifecycle.test.ts`, `tests/time-window.test.ts`) use
  real OpenPGP.js and isolated temporary GnuPG keyrings; they never read the
  user's `~/.gnupg`.
- UI suites (`tests/ui-*.test.ts`) cover pure modules without Vue or the DOM:
  catalog parity, preference storage, difficulty math, formatting, error
  localization, and window resolution.
- See [Development](development.md) for commands and browser verification.

## Known boundaries and future work

- Candidate key generation currently runs on the main thread. Short subkey
  windows require many Ed25519 key generations; an estimation/warning flow
  mitigates the UX, but a worker-based candidate pool is the natural next
  optimization.
- There is no router or persistence of the certificate by design; a refresh
  requires re-importing the full backup.
- The CI workflow still targets `master` and GitHub Pages. Publishing this
  branch requires updating the workflow branch filters.
