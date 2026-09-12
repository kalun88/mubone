# mubone — Install Guide

> **Status: CURRENT** · user-facing install guide · verified 2026-08-21 against 1.13 alpha.

## Running multiple stations (installed app)

macOS won't launch a second copy of an app when you double-click it — it just
activates the one that's already running. To run several stations (each with
its own settings profile, sensor, and OSC port), use the double-clickable
launcher instead:

    scripts/launch-stations.command      ← double-click; edit COUNT inside for how many

Or by hand, one command per station:

    open -n -a /Applications/mubone.app --args --instance=a --osc-port=7500
    open -n -a /Applications/mubone.app --args --instance=b --osc-port=7510
    open -n -a /Applications/mubone.app --args --instance=c --osc-port=7520

Each window shows its station name in the title bar and top bar. From a dev
checkout the equivalent is `npm run stations`. See `docs/MULTI-INSTANCE-PLAN.md`.

---

## Option A: Pre-built app (no dev tools needed)

Ask Ek for the DMG — **Apple Silicon only** (M1 and later), e.g. `mubone-1.13.0-alpha-arm64.dmg`. Open it and drag **mubone** onto the Applications folder.

### First launch — the one-time unblock

mubone carries an **ad-hoc signature**, not an Apple Developer ID one: there is no paid developer account behind it and nothing is notarized. macOS quarantines anything downloaded and refuses to open it until you say, once, that you trust it. Any of these does it:

- **Double-click `Open mubone (first time).command`** in the DMG window. It clears the quarantine flag and launches the app. If macOS blocks the script itself, right-click it and choose **Open**.
- **By hand:** open mubone, let macOS block it, then go to **System Settings → Privacy & Security → Security**, find the line saying mubone was blocked, and click **Open Anyway**. Control-clicking the app and choosing Open no longer works — Apple removed that shortcut in macOS 15 (Sequoia).
- **Terminal:** `xattr -dr com.apple.quarantine /Applications/mubone.app`

It's once per version, not once per machine — a newer DMG needs it again. The DMG ships `READ ME FIRST.txt` saying the same thing, for collaborators who don't have this guide.

### Audio setup

1. Launch the app — it opens full-screen by default (press `Esc` to toggle).
2. Open the **Audio** panel (top bar).
3. Select your multi-channel audio interface as the output device.
4. Set sample rate to match your interface (48000 Hz is default).
5. Grant microphone access when prompted.

### Controlling mubone over OSC (optional)

mubone listens for binary OSC on UDP `127.0.0.1:7500` and acts on it immediately — no setup, no configuration, nothing to enable. Anything that can send OSC will do: Max, Pd, TouchOSC, a Python script, a hardware controller through a MIDI→OSC bridge. `README.md` tabulates every address the app handles.

**Max is a prototyping tool, not part of the app.** Ek keeps a Max patch to test custom OSC mappings and to try a control on the fly; anything that sends OSC — Max, Pd, TouchOSC, a script, a MIDI→OSC bridge — drives mubone the same way, and no code assumes any of them. The old example patches and their `bridge.js` relay are git history (`docs/archive/SANDBOX.md`).

---

## Option B: Run from source (for development)

### Requirements

- **Node.js** 18+ (LTS recommended)
- **Python 3** (for local HTTPS dev server, browser mode only)
- **Xcode Command Line Tools** (`xcode-select --install`) — needed to compile `audify`

### Setup

```bash
git clone <repo-url> && cd mubone
npm install
npm run rebuild          # rebuilds audify against Electron's Node ABI
```

### Run

```bash
npm run electron         # launch Electron app
```

Or for browser-only mode (stereo, no multi-channel):

```bash
python3 serve.py         # HTTPS on https://localhost:4443
```

### Build a distributable DMG

```bash
# For your own architecture:
npm run dist

# Or target a specific arch:
npm run dist:arm64
npm run dist:x64
```

Output goes to `dist/`, named with the version and architecture.

Two things happen automatically after packing (`build/after-pack.js`): audify's dylib references are rewritten from `@rpath` to `@loader_path`, then the whole bundle is **ad-hoc codesigned**. That signature is free and needs no Apple account, but it is what makes the app launchable on Apple Silicon — packing invalidates the seals Electron shipped with, and `mac.identity: null` tells electron-builder not to re-sign. A successful build ends with `[adhoc-sign] ✓ signature verifies`. Don't remove the step.

Note: building for a different architecture than your own Mac requires that `audify` can cross-compile. If this fails, build on a machine matching the target arch.

---

## Troubleshooting

**"mubone is damaged and can't be opened"** or **"Apple could not verify mubone"** — the quarantine flag, not damage. See *First launch* above, or run:
```bash
xattr -dr com.apple.quarantine /Applications/mubone.app
```

**The app quits on launch, or Console shows a code-signature error** — the ad-hoc signature is missing or stale. Apple Silicon refuses to run an unsigned arm64 binary at all. Rebuild and check the log for `[adhoc-sign] ✓ signature verifies`.

**No audio output** — Check Audio panel: make sure the correct output device is selected and the channel count matches your interface. The app defaults to stereo in browser mode; multi-channel requires Electron.

**Mic not working** — macOS requires explicit microphone permission. Check System Settings → Privacy & Security → Microphone → ensure mubone is allowed. An ad-hoc signature changes with every build, so macOS treats each new DMG as a new app and asks again.

**audify fails to compile** — Make sure Xcode CLT is installed (`xcode-select --install`). If you're on an Intel Mac and audify's prebuilt binaries are arm64-only, you may need to compile from source — ensure CMake is installed (`brew install cmake`).
