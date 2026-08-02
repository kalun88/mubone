# Export / Import Audit — 2026-07-15

> **Status: HISTORICAL** — audit of 2026-07-15; all listed fixes applied the same day (`EXPORT_VERSION` 2 → 3). The 6-point verification checklist at the bottom is **still unrun** (TODO #138).
>
> ⚠ **Superseded in part by `EXPORT-IMPORT-AUDIT-2026-08.md`** (`EXPORT_VERSION` 4) — read that first. Two things below are no longer true: the "Format today" paragraph (`STATIC_KEYS` is gone; the key list derives from `js/storage-registry.js`, and `_panels`/`_sections` became one `_prefixed` bucket), and § D's reasoning that older files need no migration because every field imports with a fallback — a key *split* in #157 broke that. § B's recommendation to replace the list with a registry was eventually taken.

Audit of `js/ui-export.js` (settings + session export/import) against the
current state surface, after several months of feature work. Findings ranked
by severity.

> **Fixes applied same day (2026-07-15):** A1–A4, all § B missing keys,
> D version gate + payload pre-validation, C1 (`live` block), C2 (fade
> re-stamp via new `stampSeedRadiusFade()` export in ui-presets.js, also
> used by `plantSeed`), C3 (`startOffset`), C5 (recording guards).
> `EXPORT_VERSION` bumped 2 → 3; v1/v2 files import via fallbacks.
> **Not done:** C4 (shared-buffer dedup — wasteful, not wrong) and the
> STATIC_KEYS → registry refactor (list retained with strengthened
> comments; revisit if it drifts again).
> Files touched: `js/ui-export.js`, `js/ui-presets.js`.
> **Revert:** `git diff` those two files; all changes are additive except
> the plantSeed stamp-block extraction.
> Verification checklist at the bottom — still to run (#137).

**Format today:** two JSON file types distinguished by `_magic`
(`mubone-setup` | `mubone-session`), `_version: 2`, audio embedded as
base64-encoded 16-bit PCM WAV. Settings export = a copy of allowlisted
localStorage keys (`STATIC_KEYS`) + `mubone_panel_*` / `mubone_sec_*` prefix
scans. Session export = settings + samples + live buffers + particles +
commits + 4 misc fields.

---

## A. Critical — reimport corrupts state

### A1. `strokeIdCounter` not restored → id collisions with imported particles
`buildSessionPayload` exports `currentStrokeId` but not `S.strokeIdCounter`.
After import (fresh reload → counter 0), the next stroke gets strokeId 1,
colliding with imported particles' ids:
- **Recency is ranked by strokeId** — everything newly recorded ranks *older*
  than the imported material, so with recencyN active, new recordings can be
  **inaudible** wherever imported particles sit. Kills the stated use case
  ("load and it's ready to play" → then keep performing).
- Undo of a new stroke also deletes imported particles sharing its id.

**Fix:** on import, `S.strokeIdCounter = Math.max(S.strokeIdCounter, maxImportedStrokeId)`
(scan imported particles + loop `strokeId`s). Consider exporting the counter
explicitly in v3.

### A2. Stale `strokeHistory` survives import → undo corruption
`applySessionPayload` never clears `S.strokeHistory`. ⌘Z after import pops a
**pre-import** entry: filters imported particles by an unrelated strokeId and
splices `liveRecBuffers` at a stale index, re-indexing imported particles'
buffer references → particles point at the wrong audio.

**Fix:** `S.strokeHistory = []` during import (undo history intentionally
doesn't survive import; document that). `S._sweepSnapshot` has the same
problem — see A4.

### A3. Zombie loops — previous session's loop nodes never stopped
Import overwrites `S.commitSlots[i]` directly. A loop playing before import
keeps its `AudioBufferSourceNode` + gain + VBAP fan-out running with **no
slot referencing it** — audio loops forever, nothing in the UI can stop it
(same node-leak class as perf-audit M2).

**Fix:** teardown pass at the top of `applySessionPayload`: for each existing
slot, `releaseSeqNodes(slot)` for loops (as `eraseAll()` does), plus
`killAllGrains()`.

### A4. Pending sweep/erase snapshot not cleared on import
If a sweep / erase-all / erase-brush snapshot is pending when a session is
imported, ⌘Z restores **pre-import** particle/buffer arrays into post-import
engine state (worklet buffer map no longer contains those AudioBuffers →
silent particles, mixed sessions).

**Fix:** `commitSweep()` (or null the snapshot) at import start.

---

## B. Settings export — `STATIC_KEYS` has drifted

The list carries a "keep in sync" warning but hasn't kept up. Missing
localStorage keys, with impact:

| Key | Written by | Impact of omission |
|---|---|---|
| `mubone_sensor_cal_v` | sensor-registry.js | **Corruption:** cal is exported without its schema-version flag. Importing machine re-runs the 2026-04-23 frame→camera migration on already-migrated data — any sensor assigned the *new* `frame` (body-reference) role is silently rewritten to `camera`. |
| `mubone_custom_speaker_angles` | ui-audio-settings.js | Custom speaker layout lost — exactly what installation/venue transfers need. |
| `mubone_projector_layout_v2` | events.js (#130, Jul 6) | Projector column layout lost (old `mubone_projector_layout` was never exported either and is now migrated away). |
| `mubone_bufferSize` | ui-audio-settings.js | Preferred audio buffer size lost. |
| `mubone-sensor-prefs` | imu-setup.js | Per-device sensor prefs lost. |
| `mubone-ximu-led-feedback` | ximu-led-feedback.js | LED feedback toggle lost. |
| `mubone_mappingTransportGlobal` | ui-sensor-mapping.js | Mapping transport global lost. |
| `mubone_osc_stream` | osc-stream.js | OSC stream config lost. |
| `mubone_staging` | snapshot-engine.js | Staging state lost. |

Notes: `mubone_panel_order` is caught **accidentally** by the `mubone_panel_`
prefix scan — fine, but worth a comment so a rename doesn't silently drop it.
`grainDiagSnapshot` (debug data) is exported deliberately? Consider dropping.
`muboneOscTrace` is a debug flag — correctly excluded.

**Fix:** add the missing keys. Better: replace the hand-maintained list with a
registry — a `PERSIST_KEYS` export in state.js that modules append to, or a
naming convention (`mubone_*` = exported unless in a small denylist) so new
features are exported by default instead of forgotten by default.

---

## C. Session payload — drift + gaps

### C1. Live performance state not captured
The session re-applies the **active preset** on import (`selectPreset`), so
live tweaks made since the preset was saved are silently discarded:
`searchRadiusDeg`, `recencyN`, `nearestMode`, `grainKAllMode`,
`grainKSeqMode`, `grainOverrides`, `grainProbability`, `scanMuted`,
`scanFadeS` (#14, Jul 6 — in neither preset, defaults, nor export),
`traceMode`, `commitMode`, `commitSlotCount`, `commitOverflow`,
`selectionMode`, `paintTicker.intervalMs`. For acousmatic/installation use
the sound on load should match the sound at export.

**Fix (v3):** add a `live: {...}` block to the payload, applied after the
preset re-apply.

### C2. Cloud radius-fade stamps not recreated
`plantSeed` stamps per-particle `_cFade${slot}` attenuation when radius fade
is on. Import restores clouds with `radiusFadeEnabled: true` but never
re-stamps; the bridge falls back to `?? 1.0` → imported fade clouds play
edge grains at full volume. **Fix:** factor the stamping loop out of
`plantSeed` and call it per imported cloud.

### C3. Loop `startOffset` not exported
Restored loops get `seq.startOffset || 0` → always resume from 0 rather than
their anchor offset. Minor (loops import stopped), but one line to fix.

### C4. Shared loop buffers duplicated
`addPlayheadFromExisting` slots share one AudioBuffer + particle array;
export encodes the same WAV once per slot and import decodes independent
copies. Wasteful (file size + memory), semantics mostly survive. Fix
optionally in v3 via buffer table + refs.

### C5. Export/import during recording not guarded
Exporting mid-recording serializes the in-progress buffer as `wav: null` →
its particles are permanently silent on reimport. Importing mid-recording
swaps `liveRecBuffers` out from under the recorder. **Fix:** block both
behind `S.isRecording` (dialog: "stop recording first").

---

## D. Format / versioning

- `_version: 2` is written but **never read** — no version gate, no migration
  hook. A future v3 (live block, buffer table) needs one. **Fix:** check
  `_version` on import; `> EXPORT_VERSION` → refuse with message; `< ` →
  migration switch (even if v1→v2 is a no-op today, the scaffold should
  exist before v3 does).
- No integrity check on payload shape — a truncated file throws mid-restore,
  leaving half-cleared state (samples wiped, particles not yet restored).
  Cheap improvement: validate required arrays exist before mutating any state.
- Size: base64 adds ~33% over raw PCM; fine at current session sizes. If
  sessions grow (long multi-buffer sets), consider a `.zip` container with
  raw WAVs + `session.json` — also opens the files to DAW inspection.

---

## Recommended fix order

1. **A1–A4** (state corruption; small, surgical — one function each).
2. **B** missing keys incl. `mubone_sensor_cal_v` (one-line list edits) +
   decide on registry-vs-list for future-proofing.
3. **D** version gate + pre-validate (small).
4. **C1/C2/C3** live block + fade re-stamp + startOffset (v3 bump).
5. **C4/C5** when convenient.

Verification checklist (after fixes): export session with live tweaks ≠
preset → import on fresh profile → (a) sound matches export, (b) record new
stroke → audible under recency, (c) ⌘Z removes only the new stroke, (d) no
zombie audio when importing over a playing session, (e) sensor with `frame`
role survives settings round-trip, (f) radius-fade cloud attenuates at edges.
