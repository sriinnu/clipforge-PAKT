# Store Screenshots Checklist

Chrome Web Store requires at least 1 screenshot; 3–5 is recommended.
**Format: 1280x800 PNG (or 640x400), no alpha, no device frames.**

Tips for all shots:

- Load the built extension from `apps/extension/dist` (`pnpm --filter
  @sriinnu/clipforge-extension build` first).
- Use the default Dark theme — it matches the icon/branding.
- Use realistic but non-sensitive sample text (e.g., a JSON payload or API
  docs snippet — structured text shows real savings; avoid anything with
  personal data).
- Zoom the browser so the UI is legible at 1280x800; crop with a consistent
  margin.

## Shot 1 — Popup, compression result (the hero)

- [ ] Open the popup on any page.
- [ ] Paste a structured sample (JSON/CSV/log, ~1–2 KB) into the input.
- [ ] Click **Compress**.
- [ ] Capture with the output, token counts, and the savings stats card
      visible. The toolbar badge showing the savings % is a bonus if you
      capture the whole browser chrome.

## Shot 2 — In-page floating button on a supported site

- [ ] Go to chatgpt.com (or claude.ai), focus the chat input with sample
      text in it.
- [ ] Hover the input so the floating ClipForge pill button appears.
- [ ] Capture the chat input + pill button. Crop tightly enough that the
      button is clearly visible.

## Shot 3 — Settings / Options page

- [ ] Open the Options page (puzzle icon → ClipForge → Options, or
      right-click the icon → Options).
- [ ] Make sure the **Site allowlist** section shows a host or two added
      (demonstrates the new editor) and the **PII handling** segmented
      control is visible.
- [ ] Capture the full settings card.

## Shot 4 — Auto-compress on paste (before/after)

- [ ] Enable "Auto-compress on paste" in settings and add the site to the
      allowlist (or leave the allowlist empty).
- [ ] On a supported site, paste the structured sample into the chat input.
- [ ] Capture the input showing the PAKT-compressed text plus the success
      flash/savings indicator.

## Shot 5 (optional) — Context menu

- [ ] Select some text on any page, right-click.
- [ ] Capture the menu showing **Compress with ClipForge** and
      **Copy as PAKT**.

## After capturing

- [ ] Verify each file is exactly 1280x800 (or 640x400).
- [ ] Name them `screenshot-1.png` … `screenshot-5.png` in this directory.
- [ ] Double-check no screenshot contains real emails, names, tokens, or
      anything from your actual accounts (Slack/Gmail shots are the risky
      ones — prefer ChatGPT/Claude for public shots).
