# mubone — Collaborator Install Guide

## Option A: Pre-built app (no dev tools needed)

Ask for the `.dmg` or `.zip` for your Mac architecture:
- **Apple Silicon** (M1/M2/M3/M4): `mubone-0.14.0-alpha-arm64.dmg`
- **Intel Mac**: `mubone-0.14.0-alpha-x64.dmg`

Open the DMG and drag **mubone** to your Applications folder. On first launch, macOS will warn about an unidentified developer — right-click the app and choose **Open**, then click **Open** again in the dialog. You only need to do this once.

### Audio setup

1. Launch the app — it opens full-screen by default (press `Esc` to toggle).
2. Open the **Audio** panel (top bar).
3. Select your multi-channel audio interface as the output device.
4. Set sample rate to match your interface (48000 Hz is default).
5. Grant microphone access when prompted.

### Max/MSP integration (optional)

The Max patches are bundled inside the app at `mubone.app/Contents/Resources/max/`. Copy the `max/` folder out if you want to run the controller patch. Requires Max 8+.

Inside Max, open `mubone-controller.maxpat`. The bridge script (`bridge.js`) sends OSC over UDP to `127.0.0.1:7500` — the Electron app listens automatically, no configuration needed.

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

Output goes to `dist/`. The DMG and ZIP will be named with the version and architecture.

Note: building for a different architecture than your own Mac requires that `audify` can cross-compile. If this fails, build on a machine matching the target arch.

---

## Troubleshooting

**"mubone is damaged and can't be opened"** — The app is unsigned. Run this in Terminal:
```bash
xattr -cr /Applications/mubone.app
```

**No audio output** — Check Audio panel: make sure the correct output device is selected and the channel count matches your interface. The app defaults to stereo in browser mode; multi-channel requires Electron.

**Mic not working** — macOS requires explicit microphone permission. Check System Settings → Privacy & Security → Microphone → ensure mubone is allowed.

**audify fails to compile** — Make sure Xcode CLT is installed (`xcode-select --install`). If you're on an Intel Mac and audify's prebuilt binaries are arm64-only, you may need to compile from source — ensure CMake is installed (`brew install cmake`).
