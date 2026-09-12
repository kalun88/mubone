// ============================================================================
// scripts/lib/probe.js — the screen probe's element walk, in ONE place.
//
// The consolidation rounds diff the app against itself: snapshot, change one
// thing, snapshot, and the diff is the deliverable. That only works if the
// probe is trustworthy, and three rounds running it was not:
//
//   · round 13/14 — it read 0 on real changes, because it only saw what was on
//     screen and the cabinet (`.right-panel`, `.top-bar`) is display:none;
//   · round 16 — its key embedded the element's FIRST CLASS NAME, so renaming a
//     class shifted every index after it and elements were compared against
//     their neighbours: 571 phantom rows and 13 false property changes;
//   · 2026-08-30 — two snapshots of the SAME build differed by 6 lines, because
//     the pointer happened to rest on a settings button during one of them.
//     :hover is hit-testing, so it depends on where the human left the mouse,
//     which is not a property of the build at all.
//
// The pointer is parked by the CALLER, not in here, because it cannot be done
// from inside the page at all. Measured 2026-08-30, and the obvious fix is the
// wrong one: `pointer-events: none` on the root does NOT clear :hover — the
// chain stays exactly as it was, and it is longer, because the root now matches
// too. Nor can a dispatched mouseout do it. Hover follows the REAL pointer, so
// only a real pointer move clears it: `rig.mouse(-20, -20)` (dev-bridge's
// `.mouse` command → webContents.sendInputEvent), which reads back as an empty
// :hover chain. scripts/screen-probe.mjs does that before every walk and
// scripts/probe-selftest.mjs asserts it.
//
// Each fix invalidated diffs that had already been accepted. So the walk lives
// here, once, and `scripts/probe-selftest.mjs` asserts it against a synthetic
// page with known mutations. Change this file, run that.
// ============================================================================

/** Source of the in-page walk. Injected into the renderer as a string because
 *  it runs there, not here. Returns one line per visible element:
 *    ctx path|x|y|w|h|font|letterSpacing|color|background|radius|borderColor */
export const ELEMENT_WALK = `
const px = n => Math.round(n * 100) / 100;
const path = (e) => {
  const seg = [];
  for (let n = e; n && n.parentElement && seg.length < 8; n = n.parentElement) {
    seg.unshift(n.tagName.toLowerCase() + ':' + [...n.parentElement.children].indexOf(n));
  }
  return seg.join('/');
};
const snapOf = (root, ctx) => {
  const out = [];
  // Positions are RELATIVE to the container with its scroll zeroed: the
  // settings host is a scroller, and absolute y moved between two snapshots of
  // the same build (1756 false diffs, round twelve).
  if (root.scrollTop) root.scrollTop = 0;
  const base = root.getBoundingClientRect();
  // Text the app rewrites changes WIDTH, which reflows the row around it. The
  // row carrying live text has its geometry neutralised; its appearance is
  // still compared.
  const LIVE_SEL = '#asLatencyLabel, .set-row-status, .map-live, .set-meter-val,' +
                   ' .mon-line, #ioMonMidiCount, #ioMonOscCount, #midiPortName,' +
                   ' #mappingFilterCount, #commitCountLabel, #asCushionLive';
  // #asCushionLive (the stall-cushion telemetry, #333) landed after this list
  // and made the self-test red on a plain reload: "out queue 10" vs "out
  // queue 16" is a different width, and 188 rows below it moved (2026-09-05).
  const liveRows = new Set();
  for (const el of root.querySelectorAll(LIVE_SEL)) {
    for (let n = el; n && n !== root; n = n.parentElement) liveRows.add(n);
    for (const k of el.querySelectorAll('*')) liveRows.add(k);
    // The row's OTHER column flexes with the live one — the description beside
    // the cushion readout was 355 px wide under "out queue 10" and 361 under
    // "16" — so the whole row is neutralised, siblings included (2026-09-05).
    const row = el.closest('.set-row') || el.parentElement;
    if (row && row !== root) for (const k of row.querySelectorAll('*')) liveRows.add(k);
  }
  // Live text is PINNED to a constant for the walk, then restored: neutralising
  // x and width hides a readout's own reflow, but its LINE COUNT sets the row's
  // height and the y of every row below — 187 rows moved when the cushion
  // readout wrapped (2026-09-05). Only leaf elements are pinned, so nothing
  // with children is flattened.
  const pinned = [];
  for (const el of root.querySelectorAll(LIVE_SEL)) {
    if (el.children.length) continue;
    pinned.push([el, el.textContent]); el.textContent = 'LIVE';
  }
  try {
  for (const e of root.querySelectorAll('*')) {
    if (!e.offsetParent) continue;
    const r = e.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const c = getComputedStyle(e);
    const live = /set-meter-(fill|peak|gated|thresh)\\b/.test(e.className || '') || liveRows.has(e);
    // A short text fingerprint, for elements whose text the app does NOT
    // rewrite. Without it the key is purely positional, so two siblings
    // swapping places is invisible — identical keys, identical geometry. Live
    // text is excluded for the same reason its width is: it is not a change.
    const own = [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    const fp = live ? 'LIVE' : own.slice(0, 12).replace(/[|]/g, ' ').split(String.fromCharCode(10)).join(' ');
    out.push([
      ctx + ' ' + (e.id ? '#' + e.id : path(e)),
      live ? 'LIVE' : px(r.x - base.x), px(r.y - base.y), live ? 'LIVE' : px(r.width), px(r.height),
      c.fontSize, c.letterSpacing, c.color, c.backgroundColor, c.borderRadius, c.borderColor, fp,
    ].join('|'));
  }
  } finally { for (const [el, txt] of pinned) el.textContent = txt; }
  return out;
};
`;
