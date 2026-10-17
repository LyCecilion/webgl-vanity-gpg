# Security model

## Trust assumptions

The application is a single-user tool that runs on `localhost` in a trusted
browser and operating system. It protects against accidental network
disclosure, accidental persistence, GPU-side leakage of secret material, and
unverified search hits. It does **not** protect against a compromised browser,
malicious extension, compromised OS, screen capture, or memory forensics.

## Network boundary

- No backend, telemetry, analytics, notifications, or remote logging.
- No external scripts, styles, images, or fonts. All assets are bundled.
- Links in the help and footer are ordinary links and are never fetched
  automatically.
- Production builds inject a Content Security Policy with
  `connect-src 'none'`, so runtime network requests fail even if code tries.
- The dev and preview servers bind to `127.0.0.1`.

## Secret material handling

- Keys and passphrases live only in page memory. They are never written to
  `localStorage`, `sessionStorage`, IndexedDB, cookies, or the console.
- Only non-sensitive preferences are persisted; see
  [UI design](ui.md#preferences).
- Search generates an unbound raw key packet. Only the public packet hash input
  is uploaded to the GPU; private parameters never leave JavaScript memory.
- Passphrases are applied after signing, and non-empty passphrases always
  encrypt. Empty passphrases are accepted only with an explicit
  *Allow unprotected* acknowledgement.
- Only the packets needed by an operation are unlocked. Unlocked material and
  unpublished candidates are cleared in `finally` blocks; secret inputs are
  cleared when an operation settles.
- A refresh discards the certificate from memory, which is why the full backup
  is the only recovery path.

JavaScript strings cannot be reliably zeroed in memory. "Clear" here means
dropping references and clearing OpenPGP.js private parameters, not a guarantee
against memory inspection.

## Verification boundary

- A GPU hit is accepted only if the library fingerprint and an independent
  `crypto.subtle.digest('SHA-1')` digest agree and the creation timestamp is
  inside the frozen window.
- The shader is self-checked once against a CPU-known fingerprint before the
  real prefix filter is used.
- Shader compilation/linking, framebuffer completeness, context loss, and
  verification failures produce errors; no key is issued and there is no
  CPU-search fallback.
- Import validates packet framing, armor type, primary key version/algorithm,
  and single-primary constraints before replacing the current certificate.
- Lifecycle operations re-parse the authoritative bytes on every call, verify
  existing signatures, and publish nothing on failure.

## Backup and device scope

- **Full backup** contains every secret in the certificate. It must be stored
  offline and never distributed. The UI requires an explicit scope
  acknowledgement, shows a SHA-256 checksum, and keeps a persistent reminder
  until the user confirms the file was saved.
- **Public key** contains no secrets and can be shared freely.
- **Device key** contains real secrets only for the selected subkeys. The
  primary key and unselected subkeys are GNU dummy packets. The export dialog
  lists exactly what is included and excluded before writing the file.
- A device key does not replace the full backup. Losing the device does not
  expose the primary secret, but the full backup is still required to manage
  the identity.

## Passphrase guidance

- Use a unique, non-empty passphrase for the primary key and for each device
  key; the UI offers show/hide and Caps Lock feedback.
- Different subkeys may use different passphrases. There is no key-derivation
  relationship between them.
- Do not reuse the passphrase of an existing device when exporting a new one.

## Supply chain

- Runtime dependencies are `openpgp@6.3.0` and `vue@3.5.x`; the OpenPGP.js
  patch fixes a TypeScript export and is version-pinned by pnpm.
- `pnpm-lock.yaml` is committed and installs should use
  `pnpm install --frozen-lockfile`.
- The production bundle is self-contained and can be audited in `dist/`.

## Reporting a problem

This is a personal fork. Open an issue on the fork repository with a minimal
reproduction, the browser/GPU, and the relevant console output. Never include a
real private key, passphrase, or full backup in a report. For security-sensitive
reports, use a private channel rather than a public issue.
