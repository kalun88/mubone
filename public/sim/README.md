# mubone sim

Granular synthesis simulator mapped to a 3D sphere. Sensor input from a BNO085 via Max/MSP.

## startup

Two servers need to be running simultaneously.

**1. HTTPS file server** (required for microphone access):
```
python3 serve.py
```
Serves the app at `https://localhost:4443`

**2. Max/OSC → WebSocket bridge:**
```
node server.js
```
Listens for OSC from Max on UDP port `7500`, forwards to browser via WebSocket on `ws://localhost:8080`

Then open `https://localhost:4443` in your browser (accept the self-signed cert warning).

## Max patch

Send OSC messages to UDP port `7500` on localhost. Supports float (`f`), int (`i`), and double (`d`) argument types.

## project structure

```
index.html        — entry point
serve.py          — HTTPS file server (requires localhost.pem + localhost-key.pem)
server.js         — UDP/OSC to WebSocket bridge (requires: npm install ws)
css/
  style.css
js/
  state.js        — constants, presets, shared S object
  main.js         — app entry point, wires up modules
  audio.js        — audio context, mic recording, compressor
  grain.js        — grain scheduler
  sphere.js       — sphere geometry, particle painting, projection
  renderer.js     — canvas animation loop
  events.js       — mouse, keyboard, drag-drop handlers
  midi.js         — MIDI input and mapping modal
  mobile.js       — gyro/orientation tracking, touch handlers
  ui-samples.js   — loaded samples panel
  ui-presets.js   — presets panel
```

## SSL certs

`serve.py` expects `localhost.pem` and `localhost-key.pem` in the project root. Generate with:
```
mkcert localhost
```
