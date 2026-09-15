# Install Emulator8086 on macOS

> **Requirements:** an Apple Silicon Mac (M1/M2/M3/M4 — the build is `aarch64`-only)
> running macOS 10.15 or later.

## Option A — Install the ready-made app (recommended)

1. Download `Emulator8086_1.0.0_aarch64.dmg` from the
   [GitHub Releases](../../releases) page.
2. Double-click the `.dmg` to open it.
3. Drag **Emulator8086** into the **Applications** folder.
4. Eject the disk image.
5. Launch **Emulator8086** from Applications or Spotlight.

### First launch — unblock Gatekeeper (required, one time only)

The app is **not signed** with an Apple Developer certificate, so macOS will
refuse to open it with a message like *"Emulator8086 can't be opened because
it is from an unidentified developer"* or *"is damaged and can't be opened"*.
Pick **either** fix:

**Fix 1 — Right-click open (easiest, no Terminal):**

1. In Finder, go to **Applications**.
2. **Right-click** (or Control-click) **Emulator8086** → **Open**.
3. Click **Open** in the dialog. macOS remembers your choice from now on.

**Fix 2 — Terminal (if Fix 1 doesn't work):**

```bash
xattr -cr /Applications/Emulator8086.app
```

This clears the quarantine attribute macOS puts on downloaded apps. Run it
once, then open the app normally.

## Option B — Build it yourself from source

Requires [Node.js](https://nodejs.org/) 18+ and [Rust](https://www.rust-lang.org/tools/install)
(`rustup` is the recommended installer).

```bash
# Clone and enter the repo
git clone https://github.com/<your-username>/emulator_8086.git
cd emulator_8086

# Install JS dependencies
npm install

# Build the macOS app + disk image
npm run build:mac
```

The release artifacts are written to:

- App: `src-tauri/target/release/bundle/macos/Emulator8086.app`
- Disk image: `src-tauri/target/release/bundle/dmg/Emulator8086_1.0.0_aarch64.dmg`

Copy the `.app` to `/Applications` (or distribute the `.dmg`). The same
Gatekeeper note above applies to self-built apps, since they are unsigned too.

### Native dev window (hot-reload)

```bash
npm run tauri dev
```

This opens the app in a native window and auto-starts the Vite dev server
(`http://localhost:5173`, fixed port). Do **not** run `npm run dev`
separately in this mode.

## Troubleshooting

| Problem | Fix |
|---|---|
| *"can't be opened because it is from an unidentified developer"* | Right-click → Open, or run `xattr -cr /Applications/Emulator8086.app` |
| *"is damaged and can't be opened"* | Same fix — it means unsigned, not actually damaged: `xattr -cr /Applications/Emulator8086.app` |
| App opens but the Console window doesn't appear | The Console auto-opens on program output; you can also open it manually from the sidebar. In a browser (non-Tauri) build, allow popups for the page. |
| Wrong-architecture error on an Intel Mac | This release is Apple Silicon only; build from source on an Intel Mac instead (`npm run build:mac` builds for the host CPU). |
| `tauri` command fails | Make sure the Rust toolchain is installed (`rustc --version`) and Xcode command-line tools are present (`xcode-select --install`). |
