# Chrome Web Store Listing — ClipForge

> Draft copy for the store listing. The extension is unpublished and has not
> yet been through a full manual smoke test on the live sites — run
> `store/smoke-test.md` before submitting.

## Title

```
ClipForge — PAKT Prompt Compressor
```

(Manifest `name` is currently `ClipForge`; the store title may stay simply
"ClipForge" if you prefer it to match the manifest exactly.)

## Short description (132 chars max)

```
Compress LLM prompts locally with the PAKT format. Lossless by default, model-free, zero network calls — your text never leaves.
```

(127 characters.)

## Full description

```
ClipForge compresses the text you feed to LLM chats into PAKT, a compact,
reversible plain-text format — so the same prompt costs fewer tokens.

Everything runs locally in your browser. ClipForge makes no network
requests: no servers, no analytics, no accounts. The compressor is
model-free (pure deterministic text transforms, no AI calls).

WHERE IT WORKS
The in-page compress button and paste interception run only on:
• ChatGPT (chatgpt.com, chat.openai.com)
• Claude (claude.ai)
• Gemini (gemini.google.com)
• Slack (app.slack.com)
• Gmail (mail.google.com)

The popup and right-click context menu work on any page.

FEATURES
• One-click compression in the popup, with live token counts and savings
• Floating compress/decompress button near chat inputs on supported sites
• Auto-compress on paste — strictly opt-in, off by default
• Per-site allowlist so you control exactly where ClipForge acts
• Right-click context menu: "Compress with ClipForge" and "Copy as PAKT"
• PII guard (optional): flag prompts containing emails, phone numbers,
  credit cards, SSNs, IPs or JWTs — or redact them with placeholders
  before the text goes anywhere
• Decompress any PAKT text back to the original
• Choice of compression profiles; the default profiles are fully
  lossless and reversible. The optional "semantic" profile is lossy and
  clearly labeled as such.
• Tokenizer-aware savings for GPT-4o/GPT-4 (exact) and other model
  families (approximate)

HONEST NUMBERS
Savings depend entirely on your content. Structured inputs (JSON, CSV,
logs, repeated boilerplate) compress best; short conversational prose may
not compress at all — when there is nothing to save, ClipForge leaves
your text untouched.

PRIVACY
• No data leaves your browser. The extension makes zero network calls.
• Only your settings are stored, via Chrome's built-in sync storage.
• Compressed/decompressed text is processed in memory and never logged
  or transmitted.

Open source — see the repository for the PAKT format spec and the
compression engine.
```

## Category

Productivity (or Developer Tools).

## Notes for the dashboard

- Version submitted: 0.10.0 (keep in sync with `manifest.json`).
- Permissions to justify (see `submission-checklist.md` for suggested
  justification text): `activeTab`, `storage`, `contextMenus`,
  `clipboardRead`, `clipboardWrite`, plus host access for the six
  content-script match patterns listed above.
- Do not claim user counts, ratings, or "tested on" language anywhere —
  this is a first submission of an experimental extension.
