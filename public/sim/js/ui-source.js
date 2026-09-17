// ============================================================================
// ui-source.js — the source tiles (#247)
//
// BRUSH-MODEL § 1g: the chain is source → brush → lens, and the source must
// be performance-visible. This renders the grouped source section at the
// left end of the tile row — one tile per live input channel, each tile
// doubling as that channel's level meter, plus one sampler tile — and the
// sampler's design sheet (library + record) when design view is open.
//
// The meters ride the existing machinery: tiles carry canvases named for
// tickMeters' cache (`srcBar-cv-<i>`), and ui-meters' tickMainMeters ticks
// them in the SAME 30 fps pass that used to draw the bottom bar's input
// column (hidden under tile layout — never two reads of one analyser).
//
// Clicking a live tile routes through the one owner of the channel-change
// path — the hidden #asInputChannel select (ui-audio-settings.js) — so the
// modal, the mapping table and the engine all stay honest; the source flip
// itself goes through sampler.js selectSource().
// ============================================================================

import { S, SAMPLE_PAINT_COLORS } from './state.js';
import { deleteSample, drawSlotWaveform, toggleSamplePreview } from './ui-samples.js';

// One glyph vocabulary with the rest of the strip: a bare <path> set, drawn
// by the shared .tile <svg> at the shared size (#253). The old source tiles
// carried their own inline <svg> and their own sizes, which is why they read
// as a different species of control.
const SRC_G = {
  input:   '<path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  sampler: '<rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 14.5l3-4 2.4 3 1.6-2L17 15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
};

let _builtCount = -1;   // live channels the strip was last built for

function _liveCount() { return S.inputAnalysers?.length || 1; }

function _samplerLabel() {
  const s = S.samples[S.samplerIndex];
  if (!s) return 'sampler';
  // No hard cut: the row's .tile-nm ellipsizes, and a cut at nine characters
  // showed "test pluc" with no sign anything was missing (2026-09-03).
  return (s.name || 'sample').replace(/\.[^.]+$/, '').slice(0, 24);
}

// Full rebuild — only on channel-count change (the meter cache is invalidated
// with it). Selection and labels refresh in place via refreshSourceTiles().
export function renderSourceTiles() {
  const bar = document.getElementById('srcBar');
  if (!bar) return;
  const n = _liveCount();
  const SRC_HUE = getComputedStyle(document.body).getPropertyValue('--eng-source').trim() || '#7fa9c4';
  let html = '';
  for (let i = 0; i < n; i++) {
    // No meter in the row (#253): a live canvas among static glyphs made the
    // source group read as a different kind of control, and it was a second
    // read of analysers the bottom bar's input column already draws.
    html += `<button class="trow trow--radio src-tile" data-src-ch="${i}" style="--c:${SRC_HUE};--eng:${SRC_HUE}"` +
            ` title="source: input ${i + 1} — what the brush inks from">` +
            `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${SRC_G.input}</svg>` +
            `<span class="tile-nm">in ${i + 1}</span></button>`;
  }
  html += `<button class="trow trow--radio src-tile src-sampler" data-src="sampler" style="--c:${SRC_HUE};--eng:${SRC_HUE}"` +
          ` title="source: the sampler — a file instead of the mic; any brush paints from the current take">` +
          `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${SRC_G.sampler}</svg>` +
          `<span class="tile-nm src-sampler-lbl"></span></button>`;
  bar.innerHTML = `<div class="tbx-grp"><span class="tbx-lbl" style="--eng:${SRC_HUE}">source</span>` +
                  `<div class="tbx-tiles">${html}</div></div>`;
  _builtCount = n;
  refreshSourceTiles();
}

// In-place refresh: selection classes, sampler label/colour, capture state.
// Cheap (class toggles + one text write) — safe on the chrome's 5 Hz tick,
// where it also self-heals a channel-count change into a full rebuild.
export function refreshSourceTiles() {
  const bar = document.getElementById('srcBar');
  if (!bar) return;
  if (_liveCount() !== _builtCount) { renderSourceTiles(); return; }
  const liveSel = S.sourceKind === 'live';
  const selCh   = S.mainInputChannel ?? 0;
  bar.querySelectorAll('[data-src-ch]').forEach(el => {
    el.classList.toggle('on', liveSel && parseInt(el.dataset.srcCh, 10) === selCh);
  });
  const smp = bar.querySelector('.src-sampler');
  if (smp) {
    smp.classList.toggle('on', S.sourceKind === 'sampler');
    smp.classList.toggle('capturing', !!S.isSamplerCapturing);
    const lbl = smp.querySelector('.src-sampler-lbl');
    if (lbl) lbl.textContent = S.isSamplerCapturing ? '● rec' : _samplerLabel();
  }
}

// The live source has no sheet: the DRY MONITOR moved back to the audio
// settings (#253, Ek — "monitoring should not be a tile"). It is rig, set
// before a show, and it was the one tile whose subject was not a tool.
// Audio panel seg + audio-settings select remain the two places it lives.

// ── The sampler's design sheet — library + record ───────────────────────────
// Select, play, delete, record, drop-to-load, and a waveform per row —
// reusing the rig-view modal's own drawSlotWaveform/toggleSamplePreview so
// the two surfaces cannot drift. Crop handles stay modal-only: the sheet is
// the performance-adjacent surface, not a second editor.
export function renderSamplerSheet() {
  const sheet = document.getElementById('propRail');
  if (!sheet) return;
  const rows = S.samples.map((s, i) => {
    const color = SAMPLE_PAINT_COLORS[i % SAMPLE_PAINT_COLORS.length];
    const cur   = i === S.samplerIndex;
    return `<div class="src-row ${cur ? 'current' : ''}" data-src-row="${i}">` +
           `<span class="src-dot" style="background:${color}"></span>` +
           `<span class="src-row-name" data-src-name="${i}" title="double-click to rename">` +
           `${(s.name || 'sample ' + (i + 1)).slice(0, 24)}</span>` +
           `<span class="src-row-wavewrap"><canvas class="src-row-wave" data-src-wave="${i}"></canvas>` +
           `<span class="src-row-ph" data-ph="${i}"></span></span>` +
           `<span class="src-row-dur">${s.duration.toFixed(1)}s</span>` +
           `<button class="src-row-play" data-src-play="${i}" title="preview">\u25b6</button>` +
           // `del`, not `\u00d7` — the sheet's own close control is an \u2715 and one
           // glyph cannot mean both "close this" and "destroy this" (#284).
           `<span class="src-row-del" data-src-del="${i}" role="button" tabindex="-1"` +
           ` title="delete this take">del</span></div>`;
  }).join('');
  sheet.innerHTML =
    // The same head as every engine page (#288): name, ONE LINE saying what
    // this is, actions on the right. It had its own markup and therefore its
    // own font — the buttons set no family and fell back to the browser's.
    // The line is short on purpose (2026-09-03): a sentence here wrapped one
    // word per line into a 46px column beside the two buttons, 255px tall.
    // What it said is in the empty state and each row's title.
    // The rail is 352px at the common window: name + line + two pills is
    // all it holds, so the pills are short and the tooltips carry the rest.
    `<div class="ds-head"><b style="color:#7abcbc">sampler</b>` +
    `<span title="any brush paints from the current take while the sampler is the source">source</span>` +
    `<button type="button" class="ds-editbtn ${S.isSamplerCapturing ? 'on' : ''}" id="srcRecBtn"` +
    ` title="${S.isSamplerCapturing ? 'stop recording' : 'record the input into a new take'}">` +
    `${S.isSamplerCapturing ? '\u25a0 stop' : '\u25cf rec'}</button>` +
    `<button type="button" class="ds-editbtn" id="srcTestBtn" title="load three synthesized test sounds — pluck, pad, bass">test</button></div>` +
    `<div class="src-sheet" data-sheet="sampler">` +
    (rows || `<div class="src-empty">no takes — drag audio files anywhere, record the input, or load the test sounds</div>`) +
    `</div>`;

  sheet.querySelector('#srcRecBtn')?.addEventListener('click', () => {
    S._samplerCaptureToggle?.();
    renderSamplerSheet(); refreshSourceTiles();
  });
  sheet.querySelector('#srcTestBtn')?.addEventListener('click', () => {
    S._samplerLoadTestSamples?.();
    renderSamplerSheet(); refreshSourceTiles();
  });
  sheet.querySelectorAll('[data-src-row]').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('[data-src-del]') || e.target.closest('.src-rn')) return;
      S._samplerSelectSample?.(parseInt(el.dataset.srcRow, 10) + 1);
      renderSamplerSheet();
    });
  });
  // Double-click the name to rename the take (#288). Unlike the tool rail,
  // this row is not rebuilt by its own click, so the native `dblclick` does
  // arrive — the row's click only re-renders through renderSamplerSheet, and
  // that happens before the second press lands. Guarded anyway by rebuilding
  // from the element the event names rather than from a stale reference.
  sheet.querySelectorAll('[data-src-name]').forEach(nm => {
    nm.addEventListener('dblclick', e => {
      e.preventDefault(); e.stopPropagation();
      const i = parseInt(nm.dataset.srcName, 10);
      const smp = S.samples[i]; if (!smp || nm.querySelector('input')) return;
      const inp = document.createElement('input');
      inp.type = 'text'; inp.className = 'src-rn'; inp.maxLength = 32;
      inp.value = smp.name || 'sample ' + (i + 1);
      nm.textContent = ''; nm.appendChild(inp);
      inp.focus(); inp.select();
      let done = false;
      const finish = keep => {
        if (done) return; done = true;
        if (keep) { const v = inp.value.trim().slice(0, 32); if (v) smp.name = v; }
        renderSamplerSheet(); refreshSourceTiles();
      };
      inp.addEventListener('blur', () => finish(true));
      inp.addEventListener('keydown', e2 => {
        e2.stopPropagation();          // digits are tile keys; not while typing
        if (e2.key === 'Enter')  { e2.preventDefault(); finish(true); }
        if (e2.key === 'Escape') { e2.preventDefault(); finish(false); }
      });
      for (const t of ['click', 'dblclick', 'mousedown'])
        inp.addEventListener(t, e2 => e2.stopPropagation());
    });
  });
  sheet.querySelectorAll('[data-src-play]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      toggleSamplePreview(parseInt(el.dataset.srcPlay, 10), el);
      _armPlayheads();
    });
  });
  _armPlayheads();   // a re-render mid-preview must not orphan the ticker
  sheet.querySelectorAll('[data-src-del]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      deleteSample(parseInt(el.dataset.srcDel, 10));
      renderSamplerSheet(); refreshSourceTiles();
    });
  });
  // Waveforms after layout settles — drawSlotWaveform sizes its canvas from
  // the parent's rect, which is 0 until the sheet has been laid out.
  requestAnimationFrame(() => {
    sheet.querySelectorAll('[data-src-wave]').forEach(cv => {
      const s = S.samples[parseInt(cv.dataset.srcWave, 10)];
      if (s?.buffer) drawSlotWaveform(cv, s.buffer);
    });
  });
}

// ── Preview playhead ────────────────────────────────────────────────────────
// A progress tint with a bright leading edge over the row's waveform while
// its preview plays. Position comes from the preview's own clock
// (S.samplePreviews[i].startTimePerfNow/startSec/duration) mapped onto the
// full file, so the tint starts at the crop-in point. Style-only writes on a
// RAF that arms on play and stops itself the first frame nothing is playing
// — prep-time UI, nothing rides the render loop when the sheet is idle.
let _phRAF = 0;
function _tickPlayheads() {
  _phRAF = 0;
  let any = false;
  document.querySelectorAll('#propRail .src-row-ph').forEach(ph => {
    const i = parseInt(ph.dataset.ph, 10);
    const prev = S.samplePreviews?.[i];
    const s = S.samples[i];
    if (prev && s?.duration) {
      any = true;
      const elapsed = Math.min((performance.now() - prev.startTimePerfNow) / 1000, prev.duration);
      ph.style.left    = (prev.startSec / s.duration * 100) + '%';
      ph.style.width   = (elapsed / s.duration * 100) + '%';
      ph.style.opacity = '1';
    } else {
      ph.style.opacity = '0';
    }
  });
  if (any) _phRAF = requestAnimationFrame(_tickPlayheads);
}
function _armPlayheads() {
  if (!_phRAF) _phRAF = requestAnimationFrame(_tickPlayheads);
}

export function initSourceTiles() {
  const bar = document.getElementById('srcBar');
  if (!bar) return;

  // The #205 canvas-ownership rule: chrome clicks never start a trace.
  bar.addEventListener('mousedown', e => e.stopPropagation());

  bar.addEventListener('click', e => {
    const ch  = e.target.closest('[data-src-ch]');
    const smp = e.target.closest('.src-sampler');
    if (!ch && !smp) return;
    const design = document.body.classList.contains('props-open');
    if (S.isPainting || S.isRecording || S.isSamplerCapturing) {
      S._samplerRefused?.('mid-stroke'); return;
    }
    if (smp) {
      S._samplerSelectSource?.('sampler');
      S._openProps?.('sampler', 'source');
      renderSamplerSheet();
    } else {
      const i = parseInt(ch.dataset.srcCh, 10);
      // The one owner of the channel-change path (rewires engine + meters).
      const sel = document.getElementById('asInputChannel');
      if (sel && sel.value !== String(i)) {
        sel.value = String(i);
        sel.dispatchEvent(new Event('change'));
      }
      S._samplerSelectSource?.('live');
      // A live channel has no sheet of its own (see the note above), so
      // whatever sheet was standing belongs to a tool you just navigated away
      // from — leaving it up says the rail is showing something it is not
      // (Ek, 2026-08-30: "in 1 should have no engine sheet out, it should
      // close whatever sheet is out when i select in 1"). The tool RAIL stays,
      // because that is the list you are picking from.
      S._closeProps?.();
    }
    refreshSourceTiles();
  });

  renderSourceTiles();

  // sampler.js and the dispatch paths repaint through this.
  S._renderSamplerSheet = renderSamplerSheet;   // tiles.js reopens the sheet on Tab
  S._renderSourceUI    = () => { refreshSourceTiles();
    if (!document.body.classList.contains('props-open')) return;
    if (document.querySelector('#propRail .src-sheet')) renderSamplerSheet(); };
  S._refreshSourceTiles = refreshSourceTiles;
  // Visible refusal: flash the strip.
  S._samplerRefused = () => {
    bar.classList.remove('flash'); void bar.offsetWidth; bar.classList.add('flash');
  };
}
