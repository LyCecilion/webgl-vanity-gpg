# Documentation

This directory contains the detailed documentation moved out of the README
during the Vue 3 rewrite. The README is intentionally limited to a short
introduction and entry points.

| Document | Contents |
| --- | --- |
| [Usage](usage.md) | Install, run, the five lifecycle workflows, defaults, GnuPG usage, troubleshooting |
| [Architecture](architecture.md) | Engine modules, `KeyDocument`, operation state machine, frontend layout |
| [Security](security.md) | Threat model, storage policy, CSP, verification boundaries |
| [UI design](ui.md) | Catppuccin tokens, responsive layout, i18n, preferences, UX decisions |
| [Development](development.md) | Toolchain, commands, tests, browser verification, branch conventions |

## Product summary

`webgl-vanity-gpg` is a localhost-only OpenPGP key lifecycle manager:

1. Search for a v4 Ed25519 primary key that is certification-only (`[C]`) and
   whose fingerprint starts with a chosen prefix.
2. Add independently searched Ed25519 signing (`[S]`) and Curve25519 encryption
   (`[E]`) subkeys.
3. Extend expirations without changing fingerprints or creation times.
4. Export the public certificate, a full private backup, or a device private
   key that only contains selected subkey secrets.

The creation-time search exploits the fact that a v4 fingerprint is the SHA-1
of the public key packet, which includes the creation timestamp. Key material
stays fixed while the GPU enumerates timestamps; secret material never reaches
the GPU, and every hit is re-checked with an independent CPU SHA-1 digest.

## Version

The rewrite is released as package version `1.0.0` on the `develop` branch.
The original upstream project lives at
[TransparentLC/webgl-vanity-gpg](https://github.com/TransparentLC/webgl-vanity-gpg).
