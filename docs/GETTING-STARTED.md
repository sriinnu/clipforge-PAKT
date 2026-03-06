# Getting Started

Get the PAKT library and ClipForge desktop app running locally. Clone to running in under 5 minutes (desktop app first build adds 2-5 min for Rust compilation).

---

## 1. Prerequisites

### Required (library development)

- **Node.js 22+** -- [nodejs.org](https://nodejs.org/)
- **pnpm 9+** -- enable via Corepack:
  ```bash
  corepack enable && corepack prepare pnpm@latest --activate
  ```
- **Git**

### Required (desktop app development)

Everything above, plus:

- **Rust** (via rustup):
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```

- **Platform-specific dependencies:**

  **Ubuntu / WSL2:**
  ```bash
  sudo apt install -y \
    libwebkit2gtk-4.1-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libsoup-3.0-dev \
    libjavascriptcoregtk-4.1-dev \
    build-essential \
    pkg-config \
    libssl-dev \
    libxdo-dev
  ```

  **macOS:**
  ```bash
  xcode-select --install
  ```

  **Windows:**
  - Visual Studio Build Tools with the **C++ workload**
  - WebView2 (pre-installed on Windows 11; [download for Windows 10](https://developer.microsoft.com/en-us/microsoft-edge/webview2/))

---

## 2. Clone & Install

```bash
git clone https://github.com/sriinnu/clipforge-PAKT.git
cd clipforge-PAKT
pnpm install
```

---

## 3. Build & Test the Library

```bash
# Build all packages
pnpm build

# Run all tests
pnpm test

# Build only the core library
pnpm build --filter @sriinnu/pakt
```

---

## 4. Try the CLI

Build the library first (`pnpm build`), then pipe data through the CLI:

```bash
# Compress a JSON file
echo '{"users":[{"name":"Alice","role":"dev"},{"name":"Bob","role":"dev"}]}' | \
  node packages/pakt-core/dist/cli.js compress

# Detect format
echo 'name,age\nAlice,30\nBob,25' | \
  node packages/pakt-core/dist/cli.js detect

# Count tokens
echo '{"hello": "world"}' | \
  node packages/pakt-core/dist/cli.js tokens

# Show savings
echo '{"users":[{"name":"Alice","role":"dev"},{"name":"Bob","role":"dev"}]}' | \
  node packages/pakt-core/dist/cli.js savings
```

---

## 5. Use as a Library

```typescript
import { compress, decompress, detect, countTokens } from '@sriinnu/pakt';

// Compress JSON
const result = compress('{"name":"Alice","age":30}');
console.log(result.compressed);
console.log(`Saved ${result.savings.totalPercent}% tokens`);

// Decompress back
const original = decompress(result.compressed, 'json');
console.log(original.text);

// Detect format
const detected = detect('name: Alice\nage: 30');
console.log(detected.format); // 'yaml'
```

`@sriinnu/pakt` supports Node 18+ when consumed as a package. Monorepo development for this repository uses Node 22+.

---

## 6. Run the Desktop App (Development)

```bash
# From the monorepo root
cd apps/desktop

# Start Tauri dev server (builds Rust backend + starts Vite frontend)
pnpm tauri dev
```

This opens the ClipForge menu bar panel. The React frontend hot-reloads on changes.

> **First run:** The Rust backend compiles from scratch, which takes 2-5 minutes. Subsequent runs are fast.

---

## 7. Build Desktop App for Distribution

```bash
cd apps/desktop
pnpm tauri build
```

This produces platform-specific installers in `apps/desktop/src-tauri/target/release/bundle/`:

| Platform | Output |
|----------|--------|
| macOS    | `.dmg` |
| Windows  | `.msi` |
| Linux    | `.AppImage` + `.deb` |

**Or use CI/CD** -- push a version tag to trigger GitHub Actions builds for all three platforms:

```bash
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions builds for macOS, Windows, and Linux, then creates a draft release.

---

## 8. Project Structure

```
clipforge-PAKT/
├── packages/
│   └── pakt-core/           # @sriinnu/pakt library
│       ├── src/              # Source code
│       ├── tests/            # Vitest tests
│       └── dist/             # Built output (ESM + CJS + DTS)
├── apps/
│   ├── desktop/              # ClipForge desktop app
│   │   ├── src/              # React frontend
│   │   ├── src-tauri/        # Rust backend (Tauri v2)
│   │   └── dist/             # Built frontend
│   └── extension/            # Experimental browser extension
├── docs/
│   ├── PAKT-FORMAT-SPEC.md   # Format specification
│   └── GETTING-STARTED.md    # This file
├── assets/                   # SVG logos
└── .github/workflows/        # CI/CD
```

---

## 9. Development Workflow

- **Library code** -- edit files in `packages/pakt-core/src/`
- **Library tests** -- run in watch mode:
  ```bash
  pnpm --filter @sriinnu/pakt test -- --watch
  ```
- **Desktop UI** -- edit files in `apps/desktop/src/` (Vite hot-reloads)
- **Rust backend** -- edit files in `apps/desktop/src-tauri/src/` (Tauri rebuilds automatically)

---

## 10. Common Commands

| Command | What it does |
|---------|-------------|
| `pnpm build` | Build all packages |
| `pnpm test` | Run all tests |
| `pnpm build --filter @sriinnu/pakt` | Build only the library |
| `pnpm --filter @sriinnu/pakt test -- --watch` | Watch mode for library tests |
| `cd apps/desktop && pnpm tauri dev` | Run desktop app in dev mode |
| `cd apps/desktop && pnpm tauri build` | Build desktop app for distribution |

---

## 11. Pre-publish Checklist

For when you are ready to publish `@sriinnu/pakt` to npm:

- [ ] All tests pass
- [ ] `pnpm build` completes cleanly with no warnings
- [ ] `pnpm pack --filter @sriinnu/pakt` produces a clean tarball
- [ ] Test the tarball in a fresh project: `npm install ./sriinnu-pakt-0.1.0.tgz`
- [ ] Verify ESM import works: `import { compress } from '@sriinnu/pakt'`
- [ ] Verify CJS require works: `const { compress } = require('@sriinnu/pakt')`
- [ ] README is accurate and up-to-date
- [ ] LICENSE file exists (MIT)
- [ ] `package.json` has correct `files`, `exports`, `main`, `module`, `types` fields
- [ ] Version bumped appropriately
