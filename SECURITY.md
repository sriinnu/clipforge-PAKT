# Security Policy

## Reporting a Vulnerability

Please report security issues through
[GitHub's private security advisory flow](https://github.com/sriinnu/clipforge-PAKT/security/advisories/new).
Do not open public issues for unreported vulnerabilities.

Expect an initial acknowledgement within 7 days. If the issue is confirmed, we
will coordinate a fix, a CVE assignment (if warranted), and a disclosure
timeline with the reporter.

## Supported Versions

Only the current minor release line receives security fixes.

| Version | Status              |
|---------|---------------------|
| 0.8.x   | Supported           |
| < 0.8   | End of life         |

## Dependency Vulnerability Policy

We run Dependabot on this repository. Alerts fall into two buckets:

**Direct dependencies.** Bumped as soon as a compatible patched release is
available, via a pull request.

**Transitive dependencies pinned by an upstream crate.** Some alerts target
crates that are not directly declared in our manifests; the vulnerable version
is pinned transitively by a dependency we *do* declare. When the upstream
crate has not yet shipped a compatible upgrade, we cannot resolve the alert
without forking the upstream or applying a `[patch.crates-io]` override that
would break the build.

In those cases we:

1. Record the alert, its transitive path, and why it is not exploitable for
   our code path in the table below.
2. Dismiss the alert on GitHub with `tolerable_risk` and a short rationale.
3. Re-check whenever the blocking upstream ships a new release. Dependabot
   automatically re-opens the alert if the dismissed advisory gains new
   metadata or if a newer vulnerable version is pulled in.

This gives a transparent, auditable record rather than a silent suppression.

### Currently dismissed (awaiting upstream)

| Alert | Package | Severity | Advisory | Blocked by | Our code path affected? |
|-------|---------|----------|----------|------------|-------------------------|
| #1    | `glib` < 0.20 | medium | [GHSA-wrw7-89jp-8q8g](https://github.com/advisories/GHSA-wrw7-89jp-8q8g) | Tauri 2.10.x → `tray-icon` → `gtk 0.18` chain (needs `gtk-rs 0.20` upstream) | No — triggers only on `glib::VariantStrIter` iteration, not exercised by this app |
| #21   | `rand` < 0.9.3 | low | [GHSA-cq8v-f236-94qc](https://github.com/advisories/GHSA-cq8v-f236-94qc) | Tauri 2.10.x → `tauri-utils 2.8.3` → `kuchikiki` → `selectors 0.24` → `phf 0.8` → `rand 0.7` (needs `tauri-utils` / `kuchikiki` upstream bump) | No — triggers only when `rand::rng()` is used together with a custom logger, which this app does not configure |

If you believe any entry in this table is incorrect or has become exploitable
for our distribution, please file a private security advisory (see
[Reporting a Vulnerability](#reporting-a-vulnerability) above).
