# WIP: Production Readiness

## Current position

PAKT is close to production-ready, but not fully there yet by a strict public-package standard.

What is already in good shape:

1. Package and app versions are aligned at `0.6.2`.
2. The core package, playground, extension, and desktop web builds pass.
3. The toolchain has been updated successfully:
   - `TypeScript 6`
   - `Vite 8`
   - `@vitejs/plugin-react 6`
   - `Vitest 4`
4. Release artifact stripping and sourcemap verification are in place.
5. Publish workflow now validates tag-to-package version match and runs package tests before publish.
6. Desktop workflow/release runner configuration is more consistent.

## Why this is still marked WIP

The repo is not yet fully polished enough for a hard “production-ready” claim without caveats.

Main reasons:

1. Lint debt still exists across the repo and is currently advisory in CI.
2. There is still older code-quality debt outside the scope of the current PR.
3. We have strong build confidence, but not full release-hardening confidence.
4. Public API surface in `@sriinnu/pakt` is broad and should be reviewed for semver stability.

## Open items before calling it fully production-ready

### 1. Lint cleanup PR

Create a dedicated follow-up PR for lint/code-quality cleanup.

Focus areas:

1. Excessive cognitive complexity in app and core functions.
2. Remaining non-null assertions in untouched core files.
3. Formatter drift in touched and nearby files.
4. Any helper extraction needed to make Biome pass cleanly.

Exit criteria:

1. `pnpm lint:strict` passes.
2. CI lint can be made strict again.

### 2. Full validation pass

Run a clean validation pass after the lint PR.

Checklist:

1. `pnpm install --frozen-lockfile`
2. `pnpm build`
3. `pnpm test`
4. `pnpm --filter @sriinnu/pakt test`
5. `pnpm --filter @sriinnu/pakt build`
6. `pnpm verify:release-artifacts`

### 3. Release workflow confidence

Before a public release:

1. Dry-run the npm publish flow on a tag in a safe environment.
2. Verify Tauri release packaging on all target runners.
3. Verify release assets do not leak sourcemaps.
4. Confirm version surfaces all report `0.6.2` consistently.

### 4. Public API review

Review what `@sriinnu/pakt` exports from the root entrypoint.

Questions to answer:

1. Which exports are part of the supported public API?
2. Which low-level layer helpers should remain internal?
3. What semver guarantees do we want to make to users?

Possible follow-up:

1. Document stable exports.
2. Move internal helpers behind subpath exports or internal-only modules.

## Explicitly deferred for this PR

These are intentionally not completed in the current branch:

1. Repo-wide lint cleanup.
2. Broad refactors for complexity reduction.
3. Public API narrowing.
4. Full desktop release-package validation beyond successful build flow updates.

## Recommendation

Short-term release stance:

1. Accept as a strong release candidate.
2. Do not market as “fully production-hardened” until the lint cleanup and final validation pass are complete.

## Owner checklist

- [x] Version coherence fixed
- [x] Toolchain upgrades validated at build level
- [x] Publish workflow improved
- [x] Release workflow metadata cleaned up
- [x] Advisory lint path made explicit
- [ ] Dedicated lint cleanup PR
- [ ] Full strict validation pass
- [ ] Release dry run
- [ ] Public API review
