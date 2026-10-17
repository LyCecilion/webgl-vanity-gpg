# webgl-vanity-gpg

A localhost-only WebGL vanity OpenPGP key lifecycle manager. Search for an Ed25519
primary key whose fingerprint starts with a chosen prefix, then add
signing/encryption subkeys, extend expirations, and export device keys that only
contain selected subkey secrets.

The application runs entirely in the browser, sends no network requests, and
never stores keys or passphrases. It is designed for local use at
`http://127.0.0.1:4173/` and can operate offline after the first build.

## Quick start

Requires Node 24, pnpm 10.11.0 and a browser with WebGL2 integer framebuffer
support. Running the behavior tests additionally requires GnuPG ≥ 2.4.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm run build
pnpm run preview -- --port 4173
```

Open <http://127.0.0.1:4173/>. For development use
`pnpm run dev -- --port 5173`.

## Documentation

- [Documentation index](docs/README.md)
- [Usage guide](docs/usage.md) — workflows, defaults, GnuPG commands
- [Architecture](docs/architecture.md) — modules, data model, state machine
- [Security](docs/security.md) — threat model and safety boundaries
- [UI design](docs/ui.md) — Catppuccin themes, responsive rules, i18n, preferences
- [Development](docs/development.md) — tests, build, verification, conventions

## Status

This is the LyCecilion fork of
[TransparentLC/webgl-vanity-gpg](https://github.com/TransparentLC/webgl-vanity-gpg).
The original project was a GPU vanity key generator; this fork keeps the
GPU SHA-1 search engine and rebuilds the interface as a local key lifecycle
tool (Vue 3 + TypeScript + Vite, Chinese/English interface, Catppuccin
Latte/Mocha themes).

## License

[GNU Affero General Public License v3.0](LICENSE).
