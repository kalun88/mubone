# OSC Audit — 2026-08-11

> **Status: CURRENT** — audit of the inbound OSC surface (`js/osc.js` dispatch + the `ACTIONS` table in `js/midi.js`), run against 1.12 alpha ahead of driving mubone from Max. **Nothing here is fixed yet** — O1–O6 are findings with proposed fixes, pending Ek's decisions. Verification harness: `scripts/osc-audit.js` (new).
>
> **Headline: the wiring is clean, the *edge semantics* are not.** Every address mubone advertises reaches a handler, and every handler reaches a real function — there is no dead address anywhere in the surface. But 39 of the 106 addresses ignore the value you send and fire on both edges, and 38 of them write `NaN` into `S` if you send a bang instead of a number. Both are silent. Both are reachable from an ordinary Max `[toggle]`.

> **Read this first.** The inbound OSC contract for `js/osc.js`. The wiring is clean (every address reaches a handler); the EDGE semantics were the findings — O1 `/trace` latching on 1-then-0, O2 trigger addresses firing on both edges, O3 a bang writing `NaN`, O4 bare bangs ignored, O5 station addressing by port with no "all", O6 the README table. The banner below predates fixes: O2's release-edge guard has shipped, so check `js/osc.js` before trusting an item's status. *Quick reference* near the end is what to send. `AUDIT_ONLY=wiring node scripts/osc-audit.js` is the instant check; the full sweep is release-only.

Prompted by the plan to control mubone from Max for the multi-station
installation. The question asked was "do the addresses actually work" —
they do. The answer that matters is what happens when Max sends something
slightly different from what the address expects, because that is what a patch
built under time pressure will do.

---

## The `fire` section was blind for three weeks (found 2026-08-24)

`scripts/osc-audit.js` reported PASS on every address for three minutes a run
while asserting nothing. The `fire` section's only check is "did this address
change any state" — and `NOISE`, the regex that filters free-running per-frame
fields out of the before/after diff, did not list `gazeTrail`. The gaze trail
appends a point every render frame, so `gazeTrail.len` differed across every
snapshot pair, `total` was never 0, and the "changed nothing — dead address?"
branch could not fire for anything.

Two fixes, both in `scripts/osc-audit.js`:

- **`gazeTrail` added to `NOISE`.** Anything that mutates per frame must be
  listed there or it blinds this section. That is the general rule; `camQ`,
  `cursorQ`, `perf` and `fps` were already there for the same reason.
- **`NEEDS_STATE` map added.** With the noise gone, 20 addresses failed at once
  — and none were dead. They are the four families this script's own header has
  always documented as needing a precondition `seedMaterial()` deliberately does
  not create: `/paint/1..10` (a loaded sample), `/mapping*` and
  `/mapping/toggle/*` (a configured row), `/cursor/tare` (a connected sensor),
  `/commit/release` + `/commit/clear` (an existing commit). They are now
  declared with their reason and reported as notes, so the assertion keeps its
  teeth for the other 107. **An address that goes quiet without being listed in
  `NEEDS_STATE` is a real finding.** Delete an entry the day its precondition
  gets seeded.

The lesson worth keeping: a harness that takes three minutes and always passes
is worse than no harness, because it buys confidence it has not earned.


## What was checked, and how

`scripts/osc-audit.js`, four sections:

| Section | Kind | What it proves |
|---|---|---|
| `wiring` | static | Every `osc:` in `ACTIONS` has a case in the `osc.js` switch; every id `osc.js` dispatches has a case in `dispatchAction`; every `S._callback` either file invokes is assigned somewhere in `js/` |
| `fire` | live, headless | A **fresh page per address**, valid payload, deep diff of `S` + the class/value of every id'd control. An address that moves nothing is dead |
| `edges` | live, headless | Bang, then an explicit `0`. Reports every address where the `0` also moved state |
| `types` | live, headless | Bang and a non-numeric symbol at every value address. Reports what went non-finite |

Fresh page per address is not incidental. The handlers write to shared `S`, so
a single page lets one address's effect mask the next one's — the first pass of
this audit was run that way and reported `/grain/overlap` as dead when it was
merely being shadowed by a `NaN` that an earlier probe had written into
`S.grainOverrides.period`. The finding was an artefact of the harness. Any
future OSC test that reuses a page will produce the same class of lie.

Limits: browser mode, no audio device, no mic, no sensor. Handlers whose only
effect is an `AudioParam` ramp with no mirrored `S` field would read as a small
diff; all of them turned out to mirror into `S`, so nothing was lost. The
`/sensor/{name}/*` generic path is out of scope here — it is covered by
`docs/EULER-VS-QUAT.md` and the sensor registry.

---

## Clean bill: the wiring itself

```
✓ all 98 advertised addresses reach the osc.js dispatch
✓ all 47 action ids dispatched from osc.js exist in ACTIONS
✓ every non-cc action resolves to a dispatchAction case or a prefix handler
✓ every S._callback invoked by osc.js / midi.js is assigned in js/
✓ all 106 addresses produced an observable change on a valid payload
```

No orphan address, no orphan action, no unassigned callback, nothing dead.
The `ACTIONS`-table-as-single-source design is doing its job — because the app's
own OSC modal is generated from the same table, the list in the UI is
**guaranteed** accurate, which is not true of the README (see O6).

---

## O1 — `/trace` latches ON if Max sends 1 and 0 back to back — ✅ MOOT (2026-09-11)

> **`/trace` and `/trace/toggle` no longer exist.** They were the main button, which fired
> whatever tool was ARMED; arming was deleted on 2026-09-11, so a press names the POSITION it
> plays and the addresses are `/palette/N`, `/palette/N/hold` and `/palette/N/toggle`. The
> finding below is kept because its *rule* still binds every hold address in the table: a
> momentary must not tap-toggle, because Max emits both edges 0 ms apart.

### The original finding

> **Superseded 2026-09-04.** The tap-toggle hybrid this finding is about no longer exists: the main button is either TOGGLE (1 starts, the next 1 stops, 0 ignored — the default) or MOMENTARY (1 starts, 0 stops), one setting above every tool (`js/brush.js` `gesturePress`). A `[t 1 0]` is one toggle press in the default mode, and a zero-length stroke in momentary, which is what a momentary button does with a bang. `TRACE_TAP_MS` / `TRACE_TAP_MIN_MS` are gone. The text below is the record.

**The worst one, and it is in exactly the place you asked me to look hardest.**

`/trace` is a hold action: `1` starts, `0` stops. But `dispatchAction`'s
`recpaint` case also implements **tap-toggle** — a press and release less than
200 ms apart, in plain `trace` mode, means "latch trace on" rather than "do a
very short stroke". That is correct for a mouse click and correct for the
spacebar. It is wrong for OSC, because Max routinely emits both edges in the
same logical event:

```
[t 1 0]  →  /trace 1  /trace 0     ← 0 ms apart
```

Measured, headless:

| Sequence | End state |
|---|---|
| `/trace 1` · wait 500 ms · `/trace 0` | idle — correct |
| `/trace 1` · wait 260 ms · `/trace 0` | idle — correct |
| **`/trace 1` · `/trace 0`** (back to back) | **`isPainting=true`, `_traceToggled=true`, recording, indicator lit** |

So a `[t 1 0]`, a `[toggle]` clicked twice quickly, a `[button]` wired through
`[t 1 0]`, or a fast double-tap on a pedal **leaves mubone recording
indefinitely** with no error and only the trace indicator to show for it. Mid-set
that is a live buffer filling forever.

**Proposed fix:** the tap-toggle window is a *human gesture* heuristic and
should not apply to a machine-generated edge pair. Either

- **(a)** put a floor under it — a press/release closer together than ~30 ms is
  not a tap, it's a message pair; treat it as a null stroke, or
- **(b)** don't tap-toggle on the OSC path at all — `/trace` becomes strictly
  momentary, and `/trace/toggle` (which already exists, and is the address
  built for pedals) is the only way to latch.

**(b) is cleaner** and matches how the two addresses are already documented,
but it makes `/trace` behave differently from the spacebar, which is a real
cost. (a) keeps one code path. Ek's call.

## O2 — 39 trigger addresses fire on *both* edges

**33 confirmed by measurement, 39 by inspection.** The six that the harness
can't show — `/undo`, `/sweep`, `/session/erase`, `/commit/drop`,
`/commit/release`, `/commit/clear` — are structurally identical to the rest;
they just happen to be idempotent against a freshly-booted page with one seeded
stroke. On a real sphere mid-set they are the *most* destructive of the set, so
read the count as 39.

Every trigger case in `osc.js` hardcodes the value it forwards:

```js
case '/undo':         S._dispatchAction?.('undo', 127);       break;
case '/erase/toggle': S._dispatchAction?.('erase_toggle', 127); break;
```

The incoming value is discarded, so `/undo 0` is identical to `/undo 1` is
identical to `/undo` (bang). A Max `[toggle]`, or any controller that sends
both edges, runs the action **twice per press**.

The MIDI path already guards against exactly this — `js/midi.js:573` skips
trigger actions on a CC release, and note-off only reaches `hold` actions. The
OSC path never got the same guard. `/preset/N` in the `default:` branch *does*
guard (`!(values.length && Number(values[0]) === 0)`), and its comment states
the rule the rest of the file doesn't follow:

> *"A bare bang selects; an explicit 0 does not, matching how every other trigger treats a release edge."*

It doesn't, currently. Measured consequences, per action shape:

| Shape | Example | Effect of a `[toggle]` (1 then 0) |
|---|---|---|
| **latching toggle** | `/erase/toggle`, `/trace/toggle` | starts then immediately stops — **looks broken, does nothing** |
| **state toggle** | `/mute`, `/handsfree`, `/app/darkmode`, `/morph/sticky`, `/cursor/radiusfade` | flips twice — no net change |
| **mode cycle** (`_bangOrStr`) | `/commit/mode`, `/grain/dir`, `/camera/mode`, `/commit/blend` (`/trace/mode` went 2026-09-05 — the grain sheet's `on end` row owns the flag) | **advances two modes, skipping one** |
| **step** | `/search/radius/inc`, `/grain/oct/up` | **double step** — +4° instead of +2°, +2400¢ instead of +1200¢ |
| **destructive** | `/undo`, `/sweep`, `/session/erase`, `/commit/drop` | **fires twice** — two strokes undone, not one |

`/erase/toggle` deserves its own note: it exists *specifically* for pedals that
can only send a press edge (that's what the comment in `midi.js:706` says), and
it is the one address most likely to be driven from a Max `[toggle]` — where it
is a guaranteed no-op. Verified headless: `/erase/toggle 1` then `0` ends with
`eraseHeld` unchanged.

Note `_bangOrStr()` compounds this: it returns `127` for *any* non-string,
including `0`, so mode-cycle addresses can't distinguish a release from a press
even in principle.

**Proposed fix:** one guard at the top of the dispatch, before the switch —

```js
// A trigger's press edge is a bang or any non-zero value; an explicit 0 is the
// release edge of a controller that sends both, and must not re-fire.
// Value addresses and hold actions are exempt — 0 is meaningful for them.
```

…with an explicit exempt set (the `hold` addresses, the value addresses,
`/cursor/scan` and `/trigger/mute` which already decode 0/1 deliberately).
Cheaper and less error-prone than editing 39 cases, and it puts the rule in one
place where the next address added inherits it.

## O3 — a bang onto a value address writes `NaN`, silently

`clamp()` is:

```js
function clamp(v, min, max) { return Math.max(min, Math.min(max, Number(v))); }
```

`Number(undefined)` is `NaN`, and `NaN` survives both `Math.min` and
`Math.max`. So **38 value addresses accept a bang — or any non-numeric symbol —
and write `NaN` straight into `S`**, with no throw and no console warning:

```
/grain/dur    → grainOverrides.duration   = NaN
/grain/per    → grainOverrides.period     = NaN
/search/k     → grainOverrides.k          = NaN
/commit/slots → commitSlotCount, seedSlotCount, seqSlotCount = NaN
… 34 more
```

Consequence depends on where the value lands. `NaN` into the grain scheduler
means grains stop being produced with no error to look at. Two of them do at
least fail loudly, because they reach an `AudioParam`:

```
/master/volume → Failed to set 'value' on AudioParam: non-finite
/house/volume  → Failed to execute 'setTargetAtTime': non-finite
```

The realistic trigger isn't someone banging `/grain/dur` on purpose — it's a
`[route]` outlet firing a bang where a float was expected, an empty `$1`, or a
Max message box sending a symbol. All of those are ordinary patch mistakes and
none of them announce themselves.

**Proposed fix:** make `clamp()` reject non-finite input rather than propagate
it — return the current value (or a sentinel the caller checks) and, under
`?debug`, warn with the address. One function, covers all 38. The guard belongs
in `clamp()` and not in each case, for the same reason as O2.

## O4 — `int 0|1` addresses ignore a bare bang

The counterpart to O3, and mostly benign, but worth writing down because it
looks like a dead address from the Max side. `/trace`, `/erase/hold`,
`/trace/trigger`, `/commit/draw`, `/mute/hold` and `/paint/N` all decode
`values[0] ? 127 : 0`, so a bare bang is `undefined` → falsy → **the release
edge**. Verified: `/erase/hold` with no arguments does nothing at all; so does
`/trace/trigger`.

This is correct per the declared `fmt: 'int 0|1'`, and the app's OSC modal shows
that format. No fix proposed — but it's the first thing to check when an address
"doesn't work" from Max, and it should be called out in the README table (O6).

Two addresses do this *right* and are worth copying if the convention is ever
revisited: `/cursor/scan` and `/trigger/mute` use `values[0] ?? 127`, so `1` =
on, `0` = off, bang = toggle. That's the most forgiving shape available and it
costs nothing.

## O5 — multi-station addressing is by port, and there is no "all"

`npm run stations` gives each instance its own UDP listen port
(`scripts/run-stations.sh`): **a = 7500, b = 7510, c = 7520**, `7500 + (i-1)*10`.
The OSC *address strings are identical across stations* — the port is the
address. Confirmed in `electron-main.js:74` and the launcher header.

So today, from Max:

- **one station** → `[udpsend 127.0.0.1 7510]` for station b. Works.
- **all stations** → fan the same message into three `[udpsend]` objects. Works,
  but you carry three send paths through the whole patch and every new station
  is a patch edit.
- **`/all/trace 1`** → does not exist.

Two other things fall out of the port-as-address design and should be known
before the installation, not during it:

1. **Outbound status is unlabelled.** `js/status-publisher.js` sends `/status/*`
   to `OSC_OUT_PORT` 7501, hardcoded, from every instance. Three stations all
   publish to the same port with the same addresses, so Max **cannot tell which
   station a `/status/trace` came from**. If the patch is meant to show
   per-station state, this needs solving too.
2. **Browser mode has no station addressing at all.** All instances connect to
   the same `ws://localhost:8080` and the relay broadcasts to every peer, so
   every station receives every message. Electron is the show path so this
   doesn't bite the installation, but it means the browser build cannot be used
   to rehearse station addressing.
3. **`sandbox/relay-updated.js` hardcodes `OSC_PORT = 7500`** — the Joy-Con relay can
   only ever reach station a.

**Proposed fix — address-prefix routing, additive to the port scheme.** The
renderer already knows its own name: `electron-preload.js:17` exposes
`instanceName` from `--mubone-instance`, and `main.js:174` reads it for the
`[a]` badge. So `handleOSC` can strip and match a leading station segment
before anything else looks at the address:

```
/a/trace 1        → only instance a acts
/all/trace 1      → every instance acts
/trace 1          → every instance acts   (unprefixed = broadcast; solo use unchanged)
```

Combined with fanning every message to all station ports, that gives **one
send path in Max** and addressing that reads the way the installation is
described. Solo use is untouched, because with no `--instance` flag there is no
name to match and the unprefixed form is what's already sent. The status side
gets the mirror treatment: publish `/a/status/trace` when an instance name
exists, bare `/status/trace` when it doesn't.

Roughly 15 lines in `osc.js`, 3 in `status-publisher.js`, plus the README table.
**Not implemented — this is a design decision, not a bug fix.** The alternative
(keep three `[udpsend]`s, change nothing) is entirely viable and has the
advantage of zero new code in the show path.

## O6 — the README OSC table is missing `/erase/hold` and `/erase/toggle`

The app's own keys/MIDI/OSC modal is generated from `ACTIONS`, so it is correct
by construction. `README.md`'s table is hand-maintained and has drifted. Absent
entirely:

```
/erase/hold  /erase/toggle  /app/projector  /scan/fade
/grain/startjitter  /morph/radial  /mapping1  /mapping2  /mapping3
```

(`/grain/oct/up`, `/search/radius/dec`, `/cursor/el_source`, `/paint/2`–`10`
and `/mapping/toggle/2`–`4` are collapsed into their siblings' rows, which is
fine.)

Both erase addresses missing is the notable one — erase is half of what this
audit was asked to check, and it isn't in the document a patch author would
read. The README's own footer says *"Source of truth: the dispatch `switch` in
`js/osc.js`"*, which is true and is why nothing is wrongly documented — but it
doesn't help someone looking for an address that was never listed.

**Proposed fix:** generate the README table from `ACTIONS` the way the modal is,
or add a `scripts/osc-audit.js` section that fails when the table and the table
disagree. The latter is smaller and keeps the README hand-writable.

---

## Quick reference — what to send from Max

Correct as of 1.12 alpha, **including current the quirks above**, for the
addresses this audit was asked about:

| Intent | Send | Notes |
|---|---|---|
| start / stop trace | `/trace 1` | toggle mode (default): each `1` flips it, `0` is ignored — a `[t 1 0]` is one press (O1 superseded 2026-09-04) |
| stop trace (momentary mode) | `/trace 0` | only when Settings → keys + MIDI → *Main button* is momentary |
| trace on/off whatever the mode | `/trace/toggle` **bang** | ⚠️ not from a `[toggle]` — 1-then-0 cancels (O2) |
| record a trigger | `/trace/trigger 1` … | follows the main button's mode, like `/trace`; bare bang does nothing |
| erase while held | `/erase/hold 1` … `/erase/hold 0` | bare bang = release = nothing (O4) |
| latch erase | `/erase/toggle` **bang** | ⚠️ not from a `[toggle]` (O2) |
| erase everything | `/session/erase` **bang** | ⚠️ a `[toggle]` fires it twice |
| undo a stroke | `/undo` **bang** | ⚠️ a `[toggle]` undoes two strokes |
| target station b | send to `127.0.0.1:7510` | port is the address; no `/b/…` prefix exists yet (O5) |
| target all stations | three `[udpsend]`s | no `/all/…` exists yet (O5) |

Rule of thumb until O2 is fixed: **drive every trigger address from a Max
`[button]` (bang), never a `[toggle]` or `[t 1 0]`.** Drive every `int 0|1`
address from something that sends genuine, time-separated edges.

---

## Reproducing

```
node scripts/osc-audit.js                       # all four sections
AUDIT_ONLY=wiring node scripts/osc-audit.js     # static only, no browser
AUDIT_ONLY=edges,types node scripts/osc-audit.js
```

`wiring` and `fire` exit non-zero on a break. `edges` and `types` report
without failing — they describe the *current* contract, and O2/O3 are decisions
about what the contract should be, not regressions against it. Once those are
settled, the corresponding section should become an assertion.
