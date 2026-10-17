# UI design and interaction model

## Visual direction

The interface is a calm, dense security tool rather than a marketing page.
Key material is the visual focus; prose is secondary and lives in help panels.
The palette is based on [Catppuccin](https://catppuccin.com/):

| Mode | Flavor | Role |
| --- | --- | --- |
| Light | **Latte** | Official light Catppuccin palette |
| Dark | **Mocha** | Official dark Catppuccin palette |
| System | Auto | Follows `prefers-color-scheme` (light → Latte, dark → Mocha) |

The theme is applied with
`document.documentElement.dataset.theme`, and the top bar exposes a quick
toggle. The preference is persisted.

### Tokens

`src/ui/styles/tokens.css` defines raw Catppuccin variables (`--ctp-base`,
`--ctp-blue`, `--ctp-green`, …) and semantic tokens:

- Background: `--color-bg`, `--color-bg-mantle`, `--color-bg-deep`
- Surfaces and borders: `--color-surface`, `--color-border(-subtle)`
- Text: `--color-text`, `--color-text-muted`, `--color-text-subtle`
- Accent, success, warning, danger, info
- Role colors: `--color-role-certify` (peach), `--color-role-sign` (blue),
  `--color-role-encrypt` (green)
- Spacing scale, radii, shadows, focus ring, transitions

Components reference semantic tokens, never raw Catppuccin names.

### Typography and spacing

- System sans-serif stack for prose and controls; monospace only for
  fingerprints, hashes, code, and commands.
- 8-point spacing scale, compact but breathable cards, 6–20 px radii.
- Fingerprints are grouped in four-character blocks; short forms are
  `4A2E 117A … C9F0 1234` with a copy button that always copies the full value.

## Layout

- Sticky top bar with product name, local-only badge, primary fingerprint chip,
  backup/device state badge, then theme/help/settings icon buttons.
- Main content is limited to `74rem`; the certificate is the only object on the
  dashboard.
- Desktop: primary key card with a nested, left-bordered subkey list; actions on
  the right.
- Dialog sizes: normal 42rem, wide 56rem, narrow 32rem.
- Breakpoints:
  - `≤900px`: two/three-column grids collapse, key cards stack, action rows wrap.
  - `≤640px`: dialogs become full-screen sheets, action buttons share the footer
    width, wizard step labels hide (numbers remain), top bar compacts, toasts
    span the viewport width.
- Touch targets are at least ~38 px; the layout was checked at 390×844.

## Component inventory

- Shell: `App.vue`, `AppTopBar.vue`, `EmptyState.vue`, `ToastHost.vue`,
  `ConfirmDialog.vue`, `BaseDialog.vue`, `Icon.vue`, `CopyButton.vue`
- Certificate: `DashboardView.vue`, `KeyTree.vue`, `KeyCard.vue`,
  `RoleBadges.vue`, `KeyDetailDialog.vue`
- Forms: `PrefixField.vue`, `TimeWindowField.vue`, `ExpiryField.vue`,
  `PassphraseInput.vue`, `NewPassphraseFields.vue`, `ComputeField.vue`
- Operations: `CreateWizard.vue`, `AddSubkeysWizard.vue`, `RenewDialog.vue`,
  `ImportDialog.vue`, `ExportDialog.vue`, `OperationOverlay.vue`,
  `ResultDialog.vue`
- Settings/help: `SettingsDialog.vue`, `HelpDialog.vue`

Dialogs use the native `<dialog>` element with `showModal()`, giving top-layer
rendering, focus containment, and Escape handling for free. Non-closable
operation dialogs suppress Escape and rely on the global shortcut to stop a
search.

## Interaction decisions

### Certificate-centric dashboard

The old UI stacked five operation forms plus status and certificate sections
vertically, with progress at the top and the action button far below. The rewrite
keeps one primary object and exposes operations as contextual actions, so users
always know what they are acting on and what they can do next.

### Wizards instead of permanent forms

Create and add-subkey flows have four steps with validation and a review screen.
Advanced knobs (threads/iterations) are a preset selector plus custom values, not
the first thing a user sees. Defaults are chosen so the common path works:
`4A2E117A` primary prefix, `4217` subkey prefix, 1 signing subkey, no encryption
subkey, 365-day subkey expiry, never-expiring primary.

### Primary creation defaults to yesterday

A subkey cannot be created before its primary key. If the primary is created
today and subkeys are added immediately, the available window is only the seconds
since the primary hit, forcing thousands of key generations (each material only
covers the window length). Defaulting the primary creation day to yesterday
leaves a full day for immediate subkey work. The date is visible and editable,
and the step explains the reason.

### Uncertainty is shown honestly

- Prefix difficulty = `16^prefixLength` expected hashes, with a category and a
  measured-rate time estimate.
- During search the UI shows actual hashes, rate, elapsed time, material count,
  and cumulative hit probability `1 - exp(-attempts / expected)`.
- The add wizard estimates the frozen window length and the number of key
  materials (`expectedHashes / windowLength`) and confirms before a short-window
  search that would be slow.
- The GPU benchmark stores a measured rate used only for estimates. Estimates
  are labeled as expected values, not guarantees.

### Backup is a first-class state

Creating, appending, or renewing marks the certificate as unbacked. The top bar
shows a warning badge, the dashboard shows a banner with the primary action, and
the browser asks before leaving. Downloading the full backup changes the message
to “confirm the file is saved”; only the explicit confirmation clears the state.
Public and device exports never clear it.

### Scoped exports

The device export wizard lists every subkey with eligibility reasons, then shows
an include/exclude scope summary before the export. Success displays the file
name and SHA-256 checksum. The full backup requires an acknowledgement and also
shows a checksum.

### Errors are localized and recoverable

Engine errors stay in English for the Node test surface; `src/ui/errors.ts` maps
known failures to localized copy and keeps the raw message as technical detail.
`UiError` carries a message key for UI validation. Validation errors appear in
the wizard, and toasts never replace the current certificate.

## Preferences

Stored in `localStorage` under `webgl-vanity-gpg.preferences.v1`:

```ts
type Preferences = {
    version: 1;
    locale: 'zh-CN' | 'en';
    theme: 'auto' | 'latte' | 'mocha';
    viewZone: 'local' | 'utc';
    computePreset: 'auto' | 'fast' | 'light' | 'custom';
    threads: number;
    iterations: number;
    soundEnabled: boolean;
    measuredRate: number | null;
};
```

Unknown or invalid values are normalized to defaults; storage failures never
break the page. A short-lived v1 build stored the light mode as `macchiato`;
that value is migrated to `latte` on load. Keys, passphrases, and certificate data are never added to this
object. Settings offers a reset that removes the entry.

## Internationalization

- `src/ui/i18n/messages.ts` contains typed zh-CN and en catalogs. Both are
  checked for key parity by `tests/ui-i18n.test.ts`.
- `translate(locale, key, params)` replaces `{name}` placeholders; missing
  placeholders stay visible.
- First load detects the locale from `navigator.languages` when no preference is
  stored; the language setting switches instantly and updates
  `document.documentElement.lang` and the document title.
- Numbers, timestamps, and hash counts use stable formatting: timestamps are
  `YYYY-MM-DD HH:mm:ss` in the selected zone (local or UTC), independent of the
  UI language.

## Motion

Motion is intentionally short and functional: it explains a state change and
never delays a cryptographic operation. Durations are `120ms` (fast), `180ms`
(base) and `280ms` (slow), with decelerating easing for entrances and
accelerating easing for exits.

- **Dialogs:** fade/scale in with a backdrop fade. Closing adds
  `dialog--closing` and the store delays unmount by 170 ms so the exit animation
  can play; the delay is cancelled if another dialog opens.
- **Views:** the empty state and dashboard cross-fade when a certificate is
  loaded or cleared.
- **Wizards:** step panels use an `out-in` fade/slide so the form content and
  review step do not pop abruptly.
- **Keys and toasts:** newly added subkey cards enter with a 45 ms stagger;
  toasts have enter, leave, and move animations.
- **Feedback:** copy buttons pop on success, the result check has a pop plus an
  expanding ring, banners drop in, and the active segmented-control pill pops
  when the selection moves.
- **Theme:** toggling flavors briefly add a `theme-transition` class that
  cross-fades color, border, shadow, fill, and stroke for 220 ms.
- **Progress:** the probability meter keeps its width transition and adds a
  subtle shimmer while a search is running.

`prefers-reduced-motion: reduce` disables all animations and transitions,
closes dialogs immediately, skips the theme cross-fade, and explicitly disables
the native-dialog pseudo-element animations. No separate in-app motion setting
is needed.

## Accessibility

- Semantic landmarks, skip link, labelled form fields, labelled icon buttons.
- Focus-visible outlines everywhere; native dialog focus containment.
- `aria-live` for status and toast regions; progress is visual and does not
  flood screen readers.
- Keyboard shortcuts: `Esc` stops a running search (and closes dialogs),
  `Cmd/Ctrl+Enter` submits the focused wizard step.
- Show/hide passphrase controls, Caps Lock warning, no paste blocking.
- Reduced-motion support disables transitions and animations.
- Color is not the only signal: badges and icons carry text labels.

Known limitations: native `<input type="date">` follows the browser locale even
though internal timestamps are ISO-like; extremely long operation logs are not
announced through a dedicated live region.
