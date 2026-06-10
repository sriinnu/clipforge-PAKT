# Manual Smoke Test — ClipForge Extension

Run this before submitting to the Chrome Web Store. **No automated browser
test exists for these flows, and none of the rows below have been executed
yet — the results table is intentionally empty until a human runs it.**

## Setup

1. `pnpm --filter @sriinnu/clipforge-extension build`
2. Chrome → `chrome://extensions` → enable Developer mode → **Load
   unpacked** → select `apps/extension/dist`.
3. Confirm the ClipForge icon appears in the toolbar with no errors on the
   extensions page ("Errors" button absent or empty).

Sample text to use everywhere (structured → guaranteed savings): copy a
~1 KB JSON blob, e.g. from `packages/pakt-core/README.md` examples.

## A. Popup (any page)

1. Click the toolbar icon. Popup opens, dark theme, no console errors
   (inspect via right-click → Inspect).
2. Paste sample JSON into the input → click **Compress** → output appears,
   token counts and savings shown, badge shows a green `%`.
3. Click **Copy**, paste elsewhere — clipboard holds the PAKT text.
4. Paste the PAKT text back into the popup → it should offer/perform
   decompress → output matches the original text exactly (lossless check).

## B. Settings persistence

1. Open Options (right-click icon → Options).
2. Change profile to `structure`, set PII to `Flag`, add `chatgpt.com` to
   the site allowlist via the new editor, switch theme to OLED.
3. Try adding an invalid host (`not a host!`) → inline error, not added.
4. Remove a host with the **Remove** button → row disappears.
5. Close and reopen Options AND the popup → all values persisted.
6. Keyboard-only pass: Tab reaches the allowlist input, Enter adds a host,
   Tab reaches each Remove button, Enter activates it.

## C. Per-site checks

For each site below, with the site present in the allowlist (or allowlist
empty):

1. **Button injection**: focus/hover the message input → floating ClipForge
   pill appears near it.
2. **Manual compress**: with sample text in the input, click the pill →
   text is replaced by PAKT, savings flash shows. Click again → decompresses
   back to the original.
3. **Paste interception** (enable "Auto-compress on paste" first): paste the
   sample → input receives compressed text instead of the original. With
   the toggle OFF, paste is untouched.
4. **Allowlist negative**: remove the host from the allowlist (with at
   least one other host still listed) → pill no longer appears and paste is
   untouched on this site.
5. **Context menu**: select page text → right-click → "Copy as PAKT" →
   clipboard holds compressed text.

### Results

| # | Site | Button appears | Manual compress/decompress | Paste intercept (on) | Paste untouched (off) | Allowlist negative | Context menu | Notes |
|---|------|----------------|---------------------------|----------------------|----------------------|--------------------|--------------|-------|
| 1 | chatgpt.com | | | | | | | |
| 2 | chat.openai.com (legacy) | | | | | | | |
| 3 | claude.ai | | | | | | | |
| 4 | gemini.google.com | | | | | | | |
| 5 | app.slack.com | | | | | | | |
| 6 | mail.google.com | | | | | | | |

Mark each cell PASS / FAIL / N-A, with details in Notes. Selector drift is
the most likely failure (these sites change their DOM frequently) — the
selectors live in `src/shared/site-support.ts`.

## D. Regression sweep

- [ ] Popup works on a page with no content script (e.g. example.com).
- [ ] No errors under `chrome://extensions` → ClipForge → Errors after the
      full pass.
- [ ] Network tab on a supported site shows **zero requests** originating
      from the extension during compress/paste flows (filter by
      `chrome-extension://`). This backs the "no data leaves the browser"
      store claim.

## Sign-off

| Field | Value |
|---|---|
| Tested by | |
| Date | |
| Chrome version | |
| Build (git SHA) | |
| Verdict | |
