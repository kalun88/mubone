# Electron Multi-Channel Setup — Fresh Machine Checklist

> **Status: CURRENT** · operational checklist (written 2026-07-06) · still accurate for 1.11 alpha.

TODO #40 (written 2026-07-06). Getting mubone + Electron + multi-channel
output running on a machine that has never seen the project (e.g. a student
laptop at a workshop). Browser mode (`mubone.org/sim` or local `serve.py`)
is stereo-only — **multi-channel output requires the Electron wrapper**,
which owns the hardware through RtAudio (audify).

---

## Prerequisites

1. **macOS** (the Electron build targets mac; audify is built for it here).
2. **Node.js 18+** — `node --version` to check. Install via nvm or
   nodejs.org if missing.
3. **Xcode command-line tools** — needed to compile the native modules
   (audify, serialport): `xcode-select --install` (no-op if present).
4. The repo (private — needs GitHub access): `git clone <repo>` then `cd`.

## Install & first launch

5. `npm install` — pulls Electron + audify + serialport + ws.
6. `npm run rebuild` — **do not skip.** Rebuilds the native modules
   (audify/RtAudio, serialport) against the installed Electron's Node ABI.
   Symptoms of skipping: launch crash with `NODE_MODULE_VERSION` mismatch,
   or "Cannot find module 'audify'".
7. `npm run electron` — launches the app. First launch: grant microphone
   permission when macOS asks (System Settings → Privacy → Microphone if
   the dialog was dismissed).

## Audio interface

8. Connect the interface (e.g. Yamaha TF, Scarlett 18i20) **before**
   launching, or relaunch after connecting — device enumeration happens
   through RtAudio and hot-plug detection is not guaranteed.
9. Open **audio settings** (gear in the top bar) →
   - **Output device**: pick the interface. The dropdown shows true channel
     counts from RtAudio (not the 2ch WebRTC limit).
   - **Channels**: set the speaker count (e.g. 8). When the interface has
     ≥ 4 outputs, the **last two channels become the headphone/monitor
     pair** automatically — plan the physical patch accordingly
     (8 speakers = interface outs 1–8, headphones = outs 9–10 on a
     10-out device; on an exactly-8-out device it's 6 speakers + 2 monitor
     unless routing is changed in the panel).
   - **Buffer size**: 1024 is the safe default. 256 is a good live
     compromise. 128 is the minimum-latency show setting — it leaves only
     ~2.7 ms per audio callback, so only use it on a machine that has been
     soundchecked at that size (see `PERFORMANCE-AUDIT-2026-07.md`).
     Changing buffer size restarts the app (by design).
   - **Sample rate**: the app matches the AudioContext rate (48 kHz
     preferred). If the interface is locked to 44.1 kHz it will fall back —
     fine, just don't change it mid-session.
   - **Input device**: select the interface's input and the channel the
     performer's mic is on. The channel meter strip confirms signal.
10. Verify: record a short phrase (spacebar), paint, and walk the cursor
    around the sphere — sound should move around the physical array.
    House output silent but headphones fine → check the monitor-to-house
    send and channel routing table in the audio panel.

## Speaker geometry

11. Default bus layout is evenly-spaced clockwise starting at front
    (speaker 0 = front). If the physical array differs, use the channel
    routing (Physical→Spatial mapping) in the audio settings to remap
    without repatching.

## Sensor input (optional for audio-only setups)

12. **x-imu3 over WiFi**: the Electron main process listens for the
    device's UDP announcements automatically (port 10000) — the sensor
    appears in the IMU setup card when powered on and on the same network.
    No Max required for this path.
13. **Max/MSP bridge** (older path / other OSC gear): patches live in
    `max/`; `bridge.js` relays OSC → the app (UDP 7500 in Electron,
    WebSocket 8080 in browser). Only needed for non-x-imu3 OSC sources or
    SoftStep-style controllers.

## Browser fallback (no Electron)

14. `python3 serve.py` → https://localhost:4443 (self-signed cert — accept
    the warning). This serves cross-origin-isolation headers required for
    SharedArrayBuffer. **Stereo only** — fine for practice, not for the
    speaker array.

## Troubleshooting

- **Crash on device switch / SIGBUS**: don't rapidly toggle devices while
  a stream is running; the app reuses one RtAudio enumerator specifically
  to avoid a CoreAudio instability — if it happens, relaunch.
- **Silent output after switching devices**: re-select the output device
  in audio settings (recreates the stream and resets IPC flow-control).
  Should be rare after the Jul 2026 credit-refund fix.
- **Buffer size mismatch warnings in the terminal**: transient during
  device switches, harmless unless continuous.
- **Clock-drift warning after ~30 min**: expected when input and output
  share one device via separate streams (`[audify] Input and output share
  the same device…`). For long sets, note it and soundcheck the full
  duration, or use separate in/out devices.
- **Everything crackles at 128 frames**: raise to 256. GC pauses on
  underpowered machines can't hit the 2.7 ms deadline.
