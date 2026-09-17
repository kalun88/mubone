// ============================================================================
// cc-mirror-audit.js — does every cc action move BOTH copies of its control?
//
// Several controls exist twice: once in a settings modal (ids beginning `as`,
// `dryMonitor…`, etc.) and once mirrored into a main-UI device panel (`ap…`).
// The mirrors are wired with `input` listeners on the modal element, so a
// setter that assigns `el.value = x` WITHOUT dispatching an `input` event
// updates the modal and silently leaves the panel behind. That is invisible
// until you drive the app from MIDI/OSC and watch the wrong slider sit still.
//
// This walks every cc action in S._actions, fires it at two different values,
// and diffs the value of every form control plus the text of every readout in
// the document. It then reports, per action, which elements moved — and flags
// any action that moved a modal element while its known panel twin stayed put.
//
// Run (no setup — launches its own muted Electron instance on a private
// profile and OSC port, so it cannot touch your presets or a live station):
//   node scripts/cc-mirror-audit.js
//   node scripts/rig-audit.js          # this plus the other suites, one boot
//
// This now runs in the real Electron app rather than browser mode. The setters
// under test are DOM-sync code either way, but the audio-node lines inside them
// no longer no-op, so a setter that throws before reaching its DOM writes is
// caught here instead of on the rig.
//
// Exits non-zero if any known mirror pair desynced.
// ============================================================================

const { launch } = require('./lib/rig');

// Known duplicated controls: panel element id → modal element id.
// Extend this when a new control gets mirrored into a main-UI device panel.
const MIRRORS = {
  apInputGainSlider:   'asInputGain',
  apMasterGainSlider:  'asOutputGain',
  apNoiseGateSlider:   'asNoiseGateSlider',
  apDryGainSlider:     'dryMonitorGainSlider',
  apInputChannelSelect:'asInputChannel',
  // The paint gate (2026-09-15). Its cc action was already being walked by the
  // sweep below, but the pair was never declared here, so nothing checked that
  // the two copies agreed — the one control on this list that is now written
  // from THREE doors: the Audio page's meter drag, MIDI/OSC, and the size
  // figure on Settings -> Visuals.
  apPaintGateSlider:   'asPaintGateSlider',
};

async function run(rig) {
  const result = await rig.evaluate(async (MIRRORS) => {
    // S is a module singleton, not a global — reach it the same way the app does.
    const { S } = await import('./js/state.js');
    const actions  = S?._actions;
    const dispatch = S?._dispatchAction;
    if (!actions || !dispatch) return { fatal: 'S._actions / S._dispatchAction not exposed' };

    // Snapshot every control value and every readout's text.
    function snap() {
      const out = {};
      document.querySelectorAll('input, select, textarea').forEach(el => {
        if (!el.id) return;
        out['#' + el.id] = (el.type === 'checkbox') ? String(el.checked) : String(el.value);
      });
      document.querySelectorAll('[id]').forEach(el => {
        if (el.children.length === 0 && el.textContent && el.textContent.length < 40) {
          out['txt:' + el.id] = el.textContent.trim();
        }
      });
      return out;
    }

    function diff(a, b) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      const changed = [];
      for (const k of keys) if (a[k] !== b[k]) changed.push(k);
      return changed;
    }

    const report = [];
    for (const a of actions) {
      if (!a || a.type !== 'cc' || !a.id) continue;
      // Two values far apart so we always see motion regardless of start point.
      dispatch(a.id, 20);
      const before = snap();
      dispatch(a.id, 110);
      const after = snap();
      const changed = diff(before, after);

      const moved = new Set(changed.map(k => k.replace(/^(txt:|#)/, '')));
      const missing = [];
      for (const [panelId, modalId] of Object.entries(MIRRORS)) {
        if (moved.has(modalId) && !moved.has(panelId)) missing.push({ panelId, modalId });
        if (moved.has(panelId) && !moved.has(modalId)) missing.push({ panelId, modalId, rev: true });
      }
      report.push({ id: a.id, label: a.label, changed, missing });
    }
    return { report };
  }, MIRRORS);

  if (result.fatal) { console.error('FATAL:', result.fatal); return 2; }
  const errors = rig.errors();
  if (errors.length) console.log('renderer errors:', errors.join(' | '), '\n');

  let bad = 0;
  for (const r of result.report) {
    if (r.changed.length === 0) {
      console.log(`·  ${r.id.padEnd(22)} no DOM change (may be canvas-only / audio-only)`);
      continue;
    }
    const flag = r.missing.length ? 'X ' : '   ';
    if (r.missing.length) bad++;
    console.log(`${flag} ${r.id.padEnd(22)} ${r.changed.join(' ')}`);
    for (const m of r.missing) {
      console.log(`     ↳ DESYNC: ${m.rev ? m.panelId + ' moved, ' + m.modalId : m.modalId + ' moved, ' + m.panelId} did not`);
    }
  }
  // ── Input-channel mirror ───────────────────────────────────────────────────
  // The channel dropdown exists in three places: the audio-settings modal's
  // hidden compat <select> (asInputChannel, which owns the change path), the
  // input-mapping table's "main (mono)" picker (asMainInputSel), and the
  // main-UI panel (apInputChannelSelect). Changing any one must move the other
  // two, and must also pull that channel's remembered input gain through to the
  // panel. Driven synthetically because headless has no audio device, so the
  // mapping table never renders — its handler is a pure delegation to the
  // compat dropdown, which is what this exercises.
  // Needs virgin DOM state (the sweep above has moved every control), which
  // used to mean a second browser. One renderer reload is the same thing.
  await rig.reload();
  const ch = await rig.evaluate(async () => {
    const { S } = await import('./js/state.js');
    const g = id => document.getElementById(id);
    const modal = g('asInputChannel'), panel = g('apInputChannelSelect');
    if (!modal || !panel) return { fatal: 'channel selects missing' };

    modal.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const o = document.createElement('option');
      o.value = String(i); o.textContent = 'ch ' + (i + 1); modal.appendChild(o);
    }
    modal.value = '0';
    S._syncAudioPanelChannels?.();

    // Put a distinctive gain on ch 1 so the per-channel restore has to move it.
    const mg = g('asInputGain');
    mg.value = '12'; mg.dispatchEvent(new Event('input', { bubbles: true }));

    const checks = [];
    modal.value = '2'; modal.dispatchEvent(new Event('change', { bubbles: true }));
    checks.push(['modal → panel channel', panel.value === '2', panel.value]);
    checks.push(['modal → panel in-gain', g('apInputGainSlider').value === mg.value,
                 `panel ${g('apInputGainSlider').value} vs modal ${mg.value}`]);

    panel.value = '1'; panel.dispatchEvent(new Event('change', { bubbles: true }));
    checks.push(['panel → modal channel', modal.value === '1', modal.value]);

    // The choice reaches the SEND SET, which the channel strip owns (2026-09-14);
    // `mainInputChannel` is derived from it. (The 'stereo' option went
    // 2026-09-18 — a sum is the strip's switches' to make, not the dropdown's.)
    checks.push(['the choice reaches the send set', JSON.stringify(S.inputSends) === '[1]',
                 JSON.stringify(S.inputSends)]);
    // `mainInputChannel` is derived from the set clamped to the device's
    // channels, and this instance has no input device — so it reads 0 here
    // whatever was chosen, and is not asserted.
    return { checks };
  });

  console.log('\n── input channel mirror ──');
  if (ch.fatal) { console.log('  FATAL:', ch.fatal); bad++; }
  else for (const [name, ok, detail] of ch.checks) {
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : '  — ' + detail}`);
  }

  // ── The size figure's gate drag reaches every mirror ──────────────────────
  // The figure on Settings -> Visuals sets the paint gate by dragging its line,
  // which is a THIRD writer of S.paintGateThreshold beside the Audio page's
  // meter and the cc road. It has to go through S._setPaintGateThreshold: that
  // setter clamps and then calls _syncGateVal(), which pushes the value into
  // the modal slider, the hidden main-panel carrier and the numeric readout.
  // Writing S.paintGateThreshold directly sets the threshold correctly and
  // leaves all three stale — right sound, wrong everywhere you would read it —
  // and that is exactly what the first cut of the figure did.
  await rig.reload();
  const fig = await rig.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const { S } = await import('./js/state.js');
    if (!document.querySelector('.settings-dialog')?.offsetParent) {
      document.getElementById('tcSettings')?.click(); await sleep(800);
    }
    [...document.querySelectorAll('.set-nav-item')].find(n => n.dataset.sec === 'viz')?.click();
    await sleep(800);
    const cv = [...document.querySelectorAll('#vizSizeFigCanvas')].find(e => e.offsetParent);
    if (!cv) return { fatal: 'the size figure did not render on Settings -> Visuals' };
    const sizesBefore = [S.vizMinSize, S.vizMaxSize, S.vizRmsMin, S.vizRmsMax].join(',');
    const r = cv.getBoundingClientRect();
    const pd = (x, t) => cv.dispatchEvent(new PointerEvent(t, {
      clientX: r.left + x, clientY: r.top + r.height / 2, pointerId: 1, bubbles: true }));
    // The gate line's x for a given dB, from the figure's own padding.
    const xAt = db => 46 + (r.width - 62) * (db + 60) / 60;
    const startDb = 20 * Math.log10(Math.max(S.paintGateThreshold, 1e-3));
    pd(xAt(startDb), 'pointerdown'); await sleep(50);
    pd(xAt(-34), 'pointermove');     await sleep(50);
    pd(xAt(-34), 'pointerup');       await sleep(250);
    const g = id => document.getElementById(id);
    return {
      movedState: Math.abs(20 * Math.log10(Math.max(S.paintGateThreshold, 1e-3)) + 34) < 2,
      asSlider:   parseFloat(g('asPaintGateSlider')?.value) === S.paintGateThreshold,
      apSlider:   parseFloat(g('apPaintGateSlider')?.value) === S.paintGateThreshold,
      apNum:      (g('apPaintGateNum')?.value || '').length > 0,
      sizesHeld:  [S.vizMinSize, S.vizMaxSize, S.vizRmsMin, S.vizRmsMax].join(',') === sizesBefore,
    };
  });

  console.log('\n── the size figure writes the gate through the one setter ──');
  if (fig.fatal) { console.log('  FATAL:', fig.fatal); bad++; }
  else for (const [name, ok] of [
    ['dragging the gate line moves the threshold',      fig.movedState],
    ['the modal slider follows',                        fig.asSlider],
    ['the main-panel carrier follows',                  fig.apSlider],
    ['the numeric readout is written',                  fig.apNum],
    ['and the four size values are untouched',          fig.sizesHeld],
  ]) {
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  }

  console.log(`\n${bad} desync(s).`);
  return bad;
}

module.exports = { run };

if (require.main === module) {
  (async () => {
    const rig = await launch();
    let bad = 1;
    try { bad = await run(rig); } finally { await rig.close(); }
    process.exit(bad ? 1 : 0);
  })().catch(e => { console.error('FATAL', e.message); process.exit(1); });
}
