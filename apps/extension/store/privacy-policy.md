# ClipForge Privacy Policy

_Last updated: 2026-06-10 · Applies to ClipForge browser extension v0.10.0_

ClipForge compresses text for LLM prompts using the PAKT format. This policy
describes exactly what the extension does with data, based on what the code
actually implements.

## The short version

- ClipForge makes **no network requests**. There is no server, no analytics,
  no telemetry, no crash reporting, and no account system.
- The only thing ClipForge stores is your **settings**.
- The text you compress is processed **in memory, locally**, and is never
  logged, persisted, or transmitted by the extension.

## What data ClipForge touches, and why

| Data | When | What happens to it |
|---|---|---|
| Text you type or paste into the popup | When you use the popup | Compressed/decompressed locally in memory; result shown to you and optionally copied to your clipboard. Discarded when the popup closes. |
| Text you select on a page | Only when you right-click and choose a ClipForge context-menu item | Sent to the extension's local service worker, compressed in memory, returned to the page or your clipboard. Never stored or transmitted. |
| Text you paste into chat inputs on supported sites | Only if you have enabled the opt-in "Auto-compress on paste" setting (off by default) | Compressed locally in the page; the compressed version replaces the paste. Never stored or transmitted. |
| Clipboard contents | Only on explicit actions (popup buttons, "Copy as PAKT" menu item) | Read or written via the clipboard APIs to perform the action you requested. Not stored. |
| Your settings | Always | Stored via `chrome.storage.sync` (see below). |

## Settings storage

ClipForge stores only its settings: compression profile, semantic budget,
auto-compress toggles, site allowlist, PII mode, theme, font, target model,
and prompt-cache target.

These are saved with `chrome.storage.sync`, which means **Chrome itself**
(your Google account's extension sync, if you have it enabled) replicates
them across your signed-in browsers. The developer never receives them and
has no infrastructure that could receive them.

No compressed text, history, statistics, or page content is ever written to
storage.

## Optional PII handling

If you enable the PII feature (off by default):

- **Flag** mode scans text locally and adds a `@warning pii` header to the
  compressed output so the receiving LLM is warned. Nothing is removed or
  reported anywhere.
- **Redact** mode replaces detected PII (emails, phone numbers, credit card
  numbers, SSNs, IP addresses, JWTs) with placeholders locally. The
  reversible mapping is kept **in memory only** and is gone when the page or
  popup is closed.

Detection happens entirely on your device.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Read the current tab's selection/input when you invoke ClipForge on it. |
| `storage` | Save your settings. |
| `contextMenus` | Provide the right-click "Compress with ClipForge" / "Copy as PAKT" items. |
| `clipboardRead` / `clipboardWrite` | Compress what's on your clipboard and copy results back, on your explicit action. |
| Host access (chatgpt.com, chat.openai.com, claude.ai, gemini.google.com, app.slack.com, mail.google.com) | Inject the in-page compress button and optional paste interception on these sites only. |

## What ClipForge does NOT do

- No network calls of any kind (verified: the source and the built bundles
  contain no `fetch`, XHR, WebSocket, or beacon usage).
- No analytics, fingerprinting, or usage tracking.
- No selling, sharing, or transferring of data — there is no data to sell.
- No reading of pages in the background: content scripts run only on the six
  hosts above, and act only when you hover/focus an input or paste with the
  opt-in setting enabled.

## Changes

If a future version changes any of the above (for example, adds an opt-in
cloud feature), this policy will be updated before that version is published
and the change will be called out in the changelog.

## Contact

Questions: open an issue on the project repository, or email
sriinnu@icloud.com.
