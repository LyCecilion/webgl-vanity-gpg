# Usage guide

## Requirements

- Node.js 24
- pnpm 10.11.0 (the version pinned by `packageManager` and the lockfile)
- A browser with WebGL2 and integer framebuffer support (Chromium or Firefox on
  a desktop GPU is recommended)
- GnuPG ≥ 2.4 only if you want to run the behavior tests or verify generated
  keys manually

## Install and run

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm run build
pnpm run preview -- --port 4173
```

Open <http://127.0.0.1:4173/>. The development server is
`pnpm run dev -- --port 5173`.

Both servers bind to `127.0.0.1`. `dist/` is self-contained: after a build, the
preview server can keep running while the machine is offline. Do not open
`index.html` through `file://`, because ES modules and the CSP require HTTP.

## Interface overview

The application has one central object: the current certificate.

- **No certificate:** the page shows two actions, *Create a vanity primary key*
  and *Import an existing private key*, plus a short explanation.
- **Certificate loaded:** the dashboard shows the primary key and its subkeys as
  a nested list, a backup state banner, and the actions *Add subkeys*,
  *Extend expiration*, *Export*, *Import / replace* and *Clear certificate*.
- **Top bar:** primary fingerprint copy chip, backup badge (`Not backed up` /
  `Backed up` / `Device key`), theme toggle, help, settings.
- **Settings:** theme (system / Latte / Mocha), language (简体中文 / English),
  display time zone, default compute preset and measured GPU rate, success
  sound, and reset of non-sensitive preferences.

All long operations are modal: the rest of the page cannot be edited while a
search, import, renewal, or export is running. `Esc` stops a search.

## 1. Create a primary key

The create wizard has four steps: identity → prefix and time → protection and
compute → review.

- **User IDs:** at least one. Name, comment, and email are combined into one
  user ID chip; several IDs can be added.
- **Fingerprint prefix:** 1–40 hexadecimal characters. Spaces are ignored and
  case does not matter. The default is `4A2E117A`.
- **Difficulty:** under the prefix the UI shows the expected hash count
  (`16^prefix length`), a category, and a time estimate once a GPU rate has been
  measured. Long prefixes warn before starting.
- **Creation-time window:** today (remaining), a specific calendar day, or a
  custom inclusive range, in local time or UTC. The window is frozen when the
  search starts, future seconds are clipped, and wide/narrow windows show the
  actual candidate second count.
- **Default date is yesterday.** This is intentional: if you add subkeys
  immediately after creating the primary, the subkey creation time must not be
  earlier than the primary. With a primary created *today*, the available
  subkey window could be only a few seconds, forcing thousands of key
  generations. A one-day-old primary leaves a full day for subkeys. You can
  change the date to today or any other day.
- **Expiration:** never (default for the primary) or a specific date. A date
  means the key remains usable through that day and expires at midnight in the
  chosen zone.
- **Protection:** a non-empty passphrase is required unless *Allow an
  unprotected private key* is explicitly checked. The passphrase is applied
  after the key and self-certifications are signed.
- **Compute:** auto (recommended), high performance, low power, or custom
  threads/iterations. These only size GPU batches; they do not affect the key
  creation time. *Measure current GPU rate* runs a short benchmark and stores
  the measured hash rate as a non-sensitive preference; it is used for time
  estimates.

When the key is found, a result sheet shows the fingerprint, real hash/time/
material statistics, and a primary **Download full backup** action. The
dashboard also shows an unconfirmed-backup banner until the backup is confirmed.

## 2. Import a private key

Import accepts one ASCII-armored private key block from a file or pasted text.
The file is parsed locally and a preview shows the primary fingerprint, user
IDs, key count, and whether this is a device key. Importing replaces the
current certificate, so a confirmation is shown when a certificate is already
loaded.

Accepted input is a single v4 Ed25519 legacy primary key with any number of
subkeys. Public-only blocks, multiple primary keys, malformed packets, and
unsupported primary algorithms are rejected without changing the current
certificate.

A device private key can be imported for viewing and public export, but because
the primary secret and some subkey secrets are GNU dummy packets, subkey
addition and renewal are blocked. The top bar labels this state *Device key*.

## 3. Add subkeys

The wizard has four steps: targets → time and expiration → passphrases →
review.

- **Signing subkeys:** 0 or more. The default is 1.
- **Encryption subkey:** optionally one per operation.
- **Prefix:** shared by all new subkeys; default `4217`.
- **Creation-time window:** today (remaining), a specific day, or a custom
  range. The start is clipped to the primary key creation time; a subkey cannot
  be created before its primary.
- **Short-window warning:** if the available window is short, each key material
  only covers a few candidate seconds, so many materials (and Ed25519 key
  generations) are required. The review step shows the window length and the
  expected material count, warns, and asks for confirmation before a very slow
  search. Choosing an earlier primary creation date avoids this.
- **Expiration:** defaults to 365 days from now and can be a specific date or
  never.
- **Passphrases:** the current primary passphrase (empty if unprotected) and a
  new passphrase for the new subkeys. Existing secret material is never
  changed.
- **All-or-nothing:** signing subkeys are searched first, then the encryption
  subkey. Nothing is published until every target is found and every binding is
  signed. Cancelling or failing leaves the current certificate unchanged.

## 4. Extend expiration

Only finite, unrevoked keys with a valid self-certification are selectable. The
dialog lists all keys with their current expiration, preselects eligible keys,
and offers one/two/three years, never, or a custom date.

Renewal only adds new signatures. Existing packets, fingerprints, and creation
times are preserved byte for byte. It cannot shorten a lifetime or revive a
revoked key. The primary passphrase is required when the primary key is
protected; a signing subkey passphrase is only needed when its cross
certification must be signed again.

## 5. Export

Three exports have different scopes:

- **Public key:** the public certificate only. Safe to distribute. The UI can
  download or copy the armored text.
- **Full private backup:** every existing secret (primary and all subkeys).
  Requires an explicit acknowledgement. The file name is
  `<FINGERPRINT>-sec.asc`; a SHA-256 checksum is shown, and the dashboard
  requires *Confirm backup is saved* after the download.
- **Device private key:** keeps the full public identity and signature history,
  but the primary key and every unselected subkey are GNU dummy packets. Only
  selected subkeys carry secret material and are re-encrypted with the new
  device passphrase. The wizard shows an explicit include/exclude scope before
  export and a SHA-256 checksum afterwards. File name:
  `<FINGERPRINT>-<device>-device-sec.asc`.

A device key never replaces a full backup. If the device is lost, only the full
backup can continue managing the identity.

## Backup discipline

Creating, adding, or renewing keys marks the certificate as *Not backed up*.
The top bar shows a warning badge, the dashboard shows a banner, and leaving the
page triggers the browser's unload confirmation. Downloading the full backup
changes the banner to *Backup download started*; only *Confirm backup is saved*
clears the state. Public or device exports do not clear it.

The page never persists keys or passphrases. A refresh or tab close discards the
certificate from memory, so keep the full backup file safe and re-import it when
needed.

## Time and search parameters

- The search window is frozen once when an operation starts. Crossing midnight
  does not move it, and future seconds are excluded.
- Calendar days are computed from adjacent midnights in the selected zone, so
  DST days of 23 or 25 hours are handled and nonexistent local times are
  rejected.
- Custom ranges include both endpoints and may be a single second, including
  Unix timestamp 0.
- Expiration dates mean usable through the day, expiring at the next midnight in
  the selected zone.
- Threads and iterations only size GPU batches. The UI shows actual SHA-1
  attempts, material count, elapsed time, and a cumulative hit probability.
- The expected hash count is `16 ^ prefixLength`; it is an expected value, not a
  guaranteed time. The probability after a number of attempts is
  `1 - exp(-attempts / expected)`.

## Using the files with GnuPG

```sh
# Import a full backup
gpg --import <FINGERPRINT>-sec.asc

# Inspect fingerprints and subkeys
gpg --list-keys --with-subkey-fingerprint

# Sign with a signing subkey (append ! to force the exact key)
gpg --local-user <S-FINGERPRINT>! --detach-sign file

# Encrypt to the encryption subkey
gpg --recipient <E-FINGERPRINT>! --encrypt file

# Device key: import only into the device keyring
gpg --import <FINGERPRINT>-<device>-device-sec.asc
```

The lifecycle tests use isolated temporary keyrings and never touch
`~/.gnupg`. See [Development](development.md) for the verification commands.

## Preferences and local storage

Only non-sensitive preferences are stored in `localStorage` under
`webgl-vanity-gpg.preferences.v1`:

- locale, theme mode, time display zone
- default compute preset, threads, iterations
- success sound on/off
- last measured GPU hash rate

Keys, passphrases, fingerprints, and certificate data are never written to
storage, cookies, or IndexedDB. *Reset preferences* in Settings clears the
preference entry.

## Troubleshooting

| Symptom | Explanation |
| --- | --- |
| WebGL2 or framebuffer error | The browser/GPU does not expose a usable WebGL2 integer framebuffer. Try a desktop Chromium with hardware acceleration. The app never falls back to CPU search. |
| Context lost during search | The GPU process reset or the driver dropped the context. No key is issued; restart the operation. |
| Very slow search with a short window | Expected; every key material only covers the window length. See the material estimate in the add wizard, or use a primary key created earlier. |
| Wrong passphrase | The exact passphrase for the selected key is required. Existing independent subkey passphrases are not derived from the primary passphrase. |
| Add/renew disabled after importing a device key | The device file intentionally lacks primary secret material and unselected subkey secrets. Import the full backup to manage the certificate. |
| Date input format differs from displayed timestamps | Native date inputs follow the browser locale; internal timestamps are always shown as `YYYY-MM-DD HH:mm:ss`. |
| `pnpm` refuses the pinned version | The project pins pnpm 10.11.0. Install that version (for example with Corepack) or run the pinned CLI explicitly; do not switch to npm, because the OpenPGP.js patch is applied by pnpm. |

## Performance notes

The full-day `4A2E117A` primary search was observed at 4,330,368,000 hashes in
88.33 s (50,120 key materials) on an AMD Radeon 780M via Chromium/ANGLE on
2026-10-15. A `4217` two-signing-plus-one-encryption subkey operation completed
in 0.35 s / 179,343 hashes. These are single observations, not promises; random
hit times vary widely. Software WebGL (SwiftShader) is far slower and is only
useful for functional checks.
