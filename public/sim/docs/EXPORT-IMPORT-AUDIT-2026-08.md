# Export / Import Audit — 2026-08-01

> **Status: CURRENT** — second audit of `js/ui-export.js`, following the storage-registry refactor (#157). **E1–E5 fixed** (`EXPORT_VERSION` 3 → 5); E6–E8 open. Supersedes the *format* description in `EXPORT-IMPORT-AUDIT-2026-07.md`, which stays as the record of the A/B/C/D findings.
>
> **E4 + E5 resolved 2026-08-01 (#161)** — Ek took both recommendations. A session no longer carries settings and embeds its resolved patch instead (`EXPORT_VERSION` 5); settings import offers merge / replace. The E2 fix's `RESTART_ONLY` reporting was **deleted** rather than kept — decoupling removed the condition it described. See the § E4 and § E5 resolution notes.

Prompted by asking whether export/import was still true after #151 (browser
audit), #155 (pot scaling), #156 (patch bank 40 → 20) and #157 (storage
registry). The short answer: the settings path is now structurally sound
because it derives from the registry, but **the session path had an
undiscovered data-loss bug introduced by #157 itself**, and the fundamental
tension in session import — it cannot reload — was never written down.

**Format today:** two JSON file types distinguished by `_magic`
(`mubone-setup` | `mubone-session`), `_version: 5`, audio embedded as
base64-encoded 16-bit PCM WAV. The two are now genuinely disjoint — **setup is
the rig, session is the music** — which is the § E4 resolution.

- **Setup** = every key in `js/storage-registry.js` except the `debug`
  category, plus one `_prefixed` bucket resolved from the registry's prefix
  list. No hand-maintained key list any more (that was #157). Import offers
  merge or replace.
- **Session** = samples + live buffers + particles + commits + 5 misc fields +
  the v3 `live` block + the resolved `patch` object. **No settings.**

**If you add persisted state, ask which of the two it belongs to.** Rig-shaped
state goes in the registry and travels in a setup automatically. Performance
state goes in the session's `live` block, which is hand-maintained — that is the
one list here that can still rot, and § C1 exists because it did.

---

## E1. `mubone_audio_defaults` split lost imported values — FIXED

**Severity: data loss on every pre-v4 import.** Introduced by #157 the day
before this audit, found by asking what happens to an *old file*.

#157 split the grab-bag `mubone_audio_defaults` into four keys, with a
one-shot migration in `loadAudioDefaults()` guarded by "don't clobber a
destination that already holds migrated data" — correct for migrating your own
storage, where a second run would wipe the split values.

But import used the same code path in the wrong order:

1. `applySettingsPayload()` writes the payload's keys. A v1–v3 file carries the
   old blob and **none** of the four successor keys.
2. `loadAudioDefaults()` then runs the split over localStorage.
3. On any machine already migrated, `mubone_seed_settings` etc. **exist**, so
   the non-clobber guard skipped the write —
4. — while the strip still deleted the fields from the blob.

Net effect: importing a v3 setup or session file **silently discarded its seed
settings, viz calibration and active patch**, and destroyed them in the process.
Only visible on a machine that had booted the new build at least once, which is
every machine after #157.

**Fix:** the migration now runs against an abstract `{get,set,has}` store
(`splitLegacyAudioBlob` in `ui-audio-settings.js`) with an `overwrite` flag, and
`applySettingsPayload` normalises the **payload** before writing any key.
In-place migration keeps `overwrite: false`; an import is an explicit
instruction to take the file's values, so it uses `overwrite: true`.

The general lesson, worth keeping: **a migration written for "my own storage,
once" is not automatically correct for "a file arriving from elsewhere."** The
two differ precisely in who should win a conflict. Normalise the payload on the
way in rather than reshaping storage afterwards.

Covered by `browser-audit.js` § reset 5c3 (both directions).

## E2. Session import applied ~4 of ~30 settings — FIXED (partially, by design)

**A session import deliberately does not reload** — the samples, particles and
commits it just restored live in memory, and a reload would discard them. So
only settings with a runtime re-apply path take effect; the rest sit in
localStorage until the next restart.

Before this audit it called three loaders (`loadAudioDefaults`,
`loadUserPresets`, `loadLocks`) while writing ~30 keys, and the summary dialog
said `session loaded` with no qualification. **You would get the imported audio
with your own key map, sensor calibration, mappings and UI scale — then a
surprise personality change on the next restart.**

**Fix:** every module that has a loader is now called
(`loadMappings`, `loadConfig` for the accessory + a `renderAll()` so an open
table notices, `loadStaging`), and the summary dialog lists what is waiting on a
restart via a new `RESTART_ONLY` table + `pendingRestart()`.

`RESTART_ONLY` is deliberately **hand-derived from module read sites, not from
`storage-registry.js`** — the registry answers "what category is this key" and
says nothing about whether a runtime re-apply path exists. Two keys
(`mubone_gesture_panel`, `mubone_radial_pins`) were in neither list when this
audit started, which is how the omission was found. If you add a loader, delete
the key from `RESTART_ONLY` and call it in `applySessionPayload` step 1.

This was honest, not solved — and **§ E4's resolution superseded it the same
day.** With settings out of the session format the condition no longer arises, so
`RESTART_ONLY` and `pendingRestart()` were deleted. The extra loader calls
(`loadMappings`, accessory `loadConfig` + `renderAll`, `loadStaging`) survive on
the pre-v5 path, which is the only path that still applies settings.

Kept here because the *finding* is what drove E4, and because the loader
inventory is worth knowing: of the eight persisted categories, only
`patches`, `mapping`, `audio` and part of `sensor` have a runtime re-apply path
at all.

## E3. `applySettingsPayload` wrote unvalidated values — FIXED

Values are raw localStorage strings. A hand-edited file with an object there
stringified to `"[object Object]"`, poisoning the key: every later `JSON.parse`
threw and the module fell back to defaults, which reads as "the import did
nothing". Non-strings are now skipped with a warning, and write failures (quota
is the realistic one) are logged rather than swallowed — a silently
half-applied setup is worse than a noisy partial.

---

## E4. Settings-in-session is a design tension, not a bug — OPEN

The session format embeds a full settings payload because the stated use case is
installation / acousmatic playback: *load one file and it's ready to play*. But
settings mostly need a reload and a session mostly can't survive one. Three ways
out:

- **(a) Report and live with it** — what E2 did. Cheapest, honest, and on the
  *same machine* the restart-only keys are already correct, so the mismatch only
  bites when moving a session between rigs. Which is the installation case.
- **(b) Decouple** — a session carries material + performance state only;
  settings are always a separate file. Restores a clean mental model
  ("*setup* is the rig, *session* is the music") at the cost of a two-step
  install: import settings → reload → import session.
- **(c) Two-phase handoff** — stash the payload, reload so every module reads
  its settings normally, then apply the material on boot. The only option that
  actually delivers the promise. Blocked on where the payload lives: a session
  with audio is far past the localStorage/sessionStorage quota, and IndexedDB
  contradicts the "localStorage only" invariant that `main.js` and the reset
  dialog both depend on. Would need that invariant revisited deliberately.

**Recommendation: (b).** The promise (a) can't keep and (c) needs a new storage
tier for is really "one file installs a whole rig" — and that is what a *setup*
file already is. Splitting makes each file honest about its job, and the
installation flow is a documented two-step rather than a silent half-apply.

### Resolved 2026-08-01 — (b), `EXPORT_VERSION` 5

The scope was larger than the recommendation implied, and the reason is worth
recording: **a session was not merely bundling settings, it depended on them.**
Import called `selectPreset(S.activePresetIndex)`, so restoring the sound meant
resolving an index against the bank — which is why the bank had to ship inside
the session, and why `activePresetIndex` had to be right. That also means a
session imported on another rig was applying *whatever patch happened to live in
slot N there*, quietly, and no one had noticed because the bank travelled along
and hid it.

So decoupling required making a session self-contained about its patch:

- `applyPresetObject(preset)` extracted from `selectPreset(index)` in
  `ui-presets.js`. `selectPreset` keeps the bank-facing work (index bookkeeping,
  button highlight, HUD label, LED flash) and delegates parameter application.
  One code path, no duplicated sparse-application logic.
- The session payload gained `patch` — a **detached deep copy** of the resolved
  patch object — plus `patchIndex` for the HUD label only. Nothing resolves
  through the index any more, which also deleted the "index past the end of this
  build's bank" fallback that #156 needed: there is no index to be out of range.
- `settings` is gone from the payload. v1–v4 sessions still import: the block is
  applied with a console warning, and a missing `patch` falls back to selecting
  `patchIndex`.
- `RESTART_ONLY` / `pendingRestart()` **deleted**. They described a condition
  that no longer exists; keeping them would have been a monument to the old
  problem. The summary dialog now only mentions settings when reading a pre-v5
  file.

The export dialog is relabelled to match the concept: **setup** ("the rig") and
**session** ("the music"), rather than "settings only" / "full session".

## E5. Settings import is a merge, not a replace — OPEN

`applySettingsPayload` writes the keys present in the payload and leaves every
other key alone. So importing a setup onto a configured machine yields a
**hybrid**: if the file has no accessory config, yours survives underneath it.
For "restore my rig on a fresh machine" that's harmless. For "load the setup we
used at that show" it silently isn't that setup.

Now cheap to fix either way, since `storage-registry.js` can enumerate exactly
what a setup file governs. **Recommendation:** offer both in the import dialog —
*merge* (default, current behaviour) and *replace* (clear every registered
non-`debug` key first). Replace is the one you want before a show; merge is the
one you want when borrowing a mapping.

### Resolved 2026-08-01 — both modes offered

The import dialog now asks before writing anything. Merge stays the default: it's
the non-destructive one, and the usual reason to import is borrowing part of a
setup. Replace calls `clearGovernedKeys()`, which clears every registered
category except `debug` via `keysFor()` — enumeration that is only safe because
`browser-audit.js` asserts the registry is complete.

The dialog shows how many setting groups the file carries and how many of yours a
merge would leave untouched, because that difference is the whole decision and it
depends on the file.

## E6. No forward-migration scaffold, and the old claim is now false — OPEN

The July audit's D-item added a version gate that refuses **newer** files, on the
reasoning that older ones need no migration because "every field added since
imports with a fallback". **E1 broke that**: v1–v3 files now need a real
structural transform, not a per-field fallback.

The fix for E1 does that transform in the right place (normalise on the way in),
which is better than a `switch (data._version)`, so no scaffold is proposed —
but the reasoning should be written down: **per-field fallbacks handle added
fields; they cannot handle a key being split or renamed.** Any future rename of
a persisted key needs a payload normaliser next to `splitLegacyAudioBlob`, and
the version gate is not what protects you.

## E7. Shared loop buffers still duplicated — OPEN (was C4)

Unchanged from July. `addPlayheadFromExisting` slots share one AudioBuffer;
export encodes the same WAV once per slot **and** again in `liveBuffers`, and
import decodes independent copies. Wasteful in file size and memory, semantics
survive. Fix via a buffer table + refs if session files get unwieldy.

## E8. Base64 container — OPEN (was D)

Base64 adds ~33% over raw PCM. Fine at current sizes. If sessions grow, a `.zip`
with raw WAVs + `session.json` would also make the audio inspectable in a DAW,
which has debugging value beyond the size saving.

---

## Verified

`scripts/browser-audit.js` § reset, **24 checks passing** — the two E1 regression
checks plus three on the v5 session payload (no settings block, patch resolved
against the bank at export, patch detached rather than a live reference), driven
through the real `buildSessionPayload` via a `__testBuildSessionPayload` seam so
the assertions are about what the file contains, not what the comments claim.

The `selectPreset` → `applyPresetObject` split was verified separately: patches
1, 5 and 10 each apply the right `grainParams.duration`, set exactly one active
button at the right index, and write the right HUD label; and a bank-free patch
object applies its params **without** moving `S.activePresetIndex`, which is the
property session import depends on. The July checklist (#138) is still unrun and still
requires hardware — E1's fix does not depend on it, but items (a), (b) and (e)
would now also exercise the pre-v4 import path.

## Revert

E1–E3 touch `js/ui-audio-settings.js` (the `_migrateAudioBlob` →
`splitLegacyAudioBlob` + `objectStore` extraction) and `js/ui-export.js`
(payload normalisation, string validation). Both additive except the
migration-function extraction. **Reverting the normaliser reintroduces the E1
data loss** — don't, without also reverting #157's blob split.

E4–E5 touch `js/ui-presets.js` (the `applyPresetObject` extraction — the only
structural change, and the one to inspect first if patch recall misbehaves),
`js/ui-export.js` (payload shape, import dialog, `clearGovernedKeys`) and
`css/style.css` (radio styling on `.reset-cat`). Reverting E4 means restoring
`settings: buildSettingsPayload()` in `buildSessionPayload` and the
`selectPreset(activePresetIndex)` call at import; v5 files would then lose their
patch, since nothing else reads `patch`. E5 reverts cleanly on its own.
