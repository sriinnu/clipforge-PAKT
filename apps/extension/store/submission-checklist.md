# Chrome Web Store Submission Checklist

Everything below is a **user action** — code, icons, and listing copy are
prepared in this repo, but nothing has been submitted, published, or
smoke-tested on the live sites yet.

## 1. Pre-flight (local)

- [ ] Run the full manual pass in `store/smoke-test.md` and fill in the
      results table. Fix any FAIL before continuing (selector drift in
      `src/shared/site-support.ts` is the usual suspect).
- [ ] `pnpm --filter @sriinnu/clipforge-extension build` — clean build.
- [ ] Verify `dist/` contains `manifest.json`, `background.js`,
      `content.js`, `popup.html/js`, `options.html/js`, and
      `icons/icon-{16,48,128}.png`.
- [ ] Bump `version` in `apps/extension/manifest.json` and `package.json`
      if anything changed since 0.10.0 (keep them in sync).
- [ ] Zip the **contents** of `dist/` (manifest at the zip root, not inside
      a folder): `cd apps/extension/dist && zip -r ../clipforge-0.10.0.zip .`

## 2. Developer account

- [ ] Register at https://chrome.google.com/webstore/devconsole (one-time
      $5 fee, requires a Google account).
- [ ] Complete the account's email verification and (recommended) 2FA.

## 3. Listing assets

- [ ] Capture screenshots per `store/screenshots.md` (1280x800 PNG).
- [ ] Optional but recommended: 440x280 small promo tile (can be derived
      from the 128px icon on a brand-dark background).
- [ ] Host the privacy policy at a public URL — e.g. commit
      `store/privacy-policy.md` and link the GitHub blob URL, or publish it
      on a GitHub Pages site. Paste that URL into the dashboard.

## 4. Dashboard form

- [ ] New item → upload the zip.
- [ ] Paste title / short description / full description from
      `store/listing.md`.
- [ ] Category: Productivity. Language: English.
- [ ] Privacy tab — single purpose statement: "Compresses text for LLM
      prompts locally using the PAKT format."
- [ ] Permission justifications (suggested wording):
  - `activeTab` — act on the user's current tab text only when invoked.
  - `storage` — persist user settings.
  - `contextMenus` — right-click compress/copy actions.
  - `clipboardRead`/`clipboardWrite` — compress clipboard text and copy
    results, on explicit user action.
  - Host permissions (6 sites) — inject the optional compress button and
    opt-in paste interception on supported LLM/chat sites only.
- [ ] Data-use disclosures: select **no** data collected/transmitted —
      consistent with the code (no network calls; settings stay in Chrome
      sync storage).
- [ ] Remote code: declare **none** (all code is bundled; verify no CDN
      scripts — there are none in this build).

## 5. Submit

- [ ] Submit for review. First reviews typically take a few days; host
      permissions on Gmail/Slack may draw extra scrutiny — the permission
      justifications above address it.
- [ ] After approval, install from the store on a clean profile and re-run
      smoke-test sections A and B.

## 6. Post-publish follow-ups

- [ ] Tag the release in git and note the store URL in the README/CHANGELOG
      (do not claim "published" anywhere in-repo until it actually is).
- [ ] Edge Add-ons port: Edge accepts Chrome MV3 zips nearly as-is —
      register at https://partner.microsoft.com/dashboard/microsoftedge
      (free), create the listing, upload the same zip, reuse the listing
      copy and privacy-policy URL. Re-run the smoke test in Edge first
      (same Chromium engine, low risk, still required honesty-wise).
- [ ] Consider adding a `key` to manifest.json after first publish to keep
      a stable extension ID across local dev and store builds.
