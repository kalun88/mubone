// ============================================================================
// MIDI + KEYBOARD MAPPING SYSTEM
// ============================================================================

import {
  S,
  PRESETS, SEARCH_RADIUS_MIN, SEARCH_RADIUS_MAX, SEARCH_RADIUS_STEP,
  LIVE_PAINT_COLORS, rebuildGrainCurves,
} from './state.js';
import { ensureAudioContext } from './audio.js';
import { startLiveRecording, stopLiveRecording } from './audio.js';
import {
  recordStrokeStart, undoLastStroke,
} from './ui-samples.js';
import {
  toggleNearestMode, dropCloud, pickupNearestCloud,
  updatePlaybackControls, flashRadiusTooltip, selectPreset,
} from './ui-presets.js';
import { wireSaveDefaultBtn } from './ui-audio-settings.js';
import { setCursorHouseMuted } from './ui-meters.js';

// Each action definition: { id, label, key, osc, type, ccFn? }
// id: null entries are section headers (group: 'label')
// type: 'hold' | 'trigger' | 'cc' (continuous 0-127)
// osc: OSC path string or null
const ACTIONS = [

  // ── Transport ──────────────────────────────────────────────────────────────
  { id: null, group: 'transport' },
  { id: 'recpaint',     label: 'rec + paint (hold)',        key: 'click / space',     osc: null,                 fmt: null,               type: 'hold' },
  { id: 'record',       label: 'record',                    key: '—',                 osc: '/record',            fmt: 'int 0|1',          type: 'trigger' },
  { id: 'mute',         label: 'mute',                      key: '—',                 osc: '/mute',              fmt: 'int 0|1',          type: 'trigger' },
  { id: 'cursor_mute',  label: 'cursor mute',               key: 'C',                 osc: '/cursor/mute',       fmt: 'int 0|1',          type: 'trigger' },
  { id: 'undo',         label: 'undo last stroke',          key: 'right click / ⌘Z',  osc: '/undo',              fmt: 'bang',             type: 'trigger' },

  // ── Grain ──────────────────────────────────────────────────────────────────
  { id: null, group: 'grain' },
  { id: 'grain_dur',    label: 'duration',                  key: '—',  osc: '/grain/dur',         fmt: 'float 1–4000 ms',   type: 'cc',
    ccFn: v => { const lo = Math.log(0.001), hi = Math.log(4.0); S.grainOverrides.duration = Math.exp(lo + (v / 127) * (hi - lo)); S.syncGrainControlsUI?.(); } },
  { id: 'grain_durvar', label: 'dur ±',                     key: '—',  osc: '/grain/durvar',      fmt: 'float 0–500 ms',    type: 'cc',
    ccFn: v => { S.grainOverrides.durVar = (v / 127) * 0.5; S.syncGrainControlsUI?.(); } },
  { id: 'grain_durjit', label: 'dur jitter',                key: '—',  osc: '/grain/durjitter',   fmt: 'float 0–1',         type: 'cc',
    ccFn: v => { S.grainOverrides.durJitter = v / 127; S.syncGrainControlsUI?.(); } },
  { id: 'grain_fade',   label: 'fade',                      key: '—',  osc: '/grain/fade',        fmt: 'float 0–50 %',      type: 'cc',
    ccFn: v => { S.grainOverrides.fadeRatio = (v / 127) * 0.5; S.syncGrainControlsUI?.(); } },
  { id: 'grain_period', label: 'period',                    key: '—',  osc: '/grain/per',         fmt: 'float 1–4000 ms',   type: 'cc',
    ccFn: v => { const lo = Math.log(0.001), hi = Math.log(4.0); S.grainOverrides.period = Math.exp(lo + (v / 127) * (hi - lo)); S.syncGrainControlsUI?.(); } },
  { id: 'grain_pervar', label: 'per ±',                     key: '—',  osc: '/grain/pervar',      fmt: 'float 0–500 ms',    type: 'cc',
    ccFn: v => { S.grainOverrides.periodVar = (v / 127) * 0.5; S.syncGrainControlsUI?.(); } },
  { id: 'grain_pitch',  label: 'pitch',                     key: '—',  osc: '/grain/pitch',       fmt: 'float 0–700 ¢',     type: 'cc',
    ccFn: v => { S.grainOverrides.pitchJitter = Math.pow(2, (v / 127) * 700 / 1200) - 1; S.syncGrainControlsUI?.(); } },
  { id: 'grain_prob',   label: 'prob',                      key: '—',  osc: '/grain/prob',        fmt: 'float 0–1',         type: 'cc',
    ccFn: v => { S.grainProbability = v / 127; S.syncGrainControlsUI?.(); } },
  { id: 'grain_pan',    label: 'spread',                    key: '—',  osc: '/grain/pan',         fmt: 'float 0–100 %',     type: 'cc',
    ccFn: v => { S.grainOverrides.panSpread = v / 127; S.syncGrainControlsUI?.(); } },
  { id: 'grain_vol',    label: 'vol',                       key: '—',  osc: '/grain/volume',      fmt: 'float 0–2',         type: 'cc',
    ccFn: v => { S.grainOverrides.volume = (v / 127) * 2; rebuildGrainCurves(); S.syncGrainControlsUI?.(); } },
  { id: 'grain_k',      label: 'k (nearest)',               key: '—',  osc: '/grain/k',           fmt: 'int 1–20',          type: 'cc',
    ccFn: v => { S.grainOverrides.k = Math.max(1, Math.round(1 + (v / 127) * 19)); S.syncGrainControlsUI?.(); } },
  { id: 'grain_retrig', label: 'retrigger (ms)',            key: '—',  osc: '/grain/retrigger',   fmt: 'float 0–500 ms',    type: 'cc',
    ccFn: v => { S.grainOverrides.retriggerMs = (v / 127) * 500; S.syncGrainControlsUI?.(); } },
  { id: 'grain_dir',    label: 'direction',                 key: '—',  osc: '/grain/dir',         fmt: 'str fwd|rev|rnd',   type: 'trigger' },

  // ── Search ─────────────────────────────────────────────────────────────────
  { id: null, group: 'search' },
  { id: 'radius_inc',   label: 'radius ↑',                  key: 'scroll up / ]',     osc: null,             fmt: null,               type: 'trigger' },
  { id: 'radius_dec',   label: 'radius ↓',                  key: 'scroll down / [',   osc: null,             fmt: null,               type: 'trigger' },
  { id: 'radius_cc',    label: 'radius (CC)',                key: '—',                 osc: '/grain/radius',  fmt: 'float 1–180',      type: 'cc',
    ccFn: v => { S.searchRadiusDeg = SEARCH_RADIUS_MIN + (v / 127) * (SEARCH_RADIUS_MAX - SEARCH_RADIUS_MIN); updatePlaybackControls(); flashRadiusTooltip(); } },
  { id: 'recency_cc',   label: 'recency N (CC)',             key: '—',                 osc: null,             fmt: 'int 1–16',         type: 'cc',
    ccFn: v => { S.recencyN = 1 + Math.round((v / 127) * 15); document.getElementById('recencyVal').textContent = S.recencyN; } },
  { id: 'snap',         label: 'toggle snap/nearest',       key: 'N',                 osc: null,             fmt: null,               type: 'trigger' },
  { id: 'k_all',        label: 'toggle k-all',              key: '—',                 osc: null,             fmt: null,               type: 'trigger' },

  // ── Presets ────────────────────────────────────────────────────────────────
  { id: null, group: 'presets' },
  { id: 'preset_prev',  label: 'preset ←',                  key: 'shift+scroll ↑',    osc: null,             fmt: null,               type: 'trigger' },
  { id: 'preset_next',  label: 'preset →',                  key: 'shift+scroll ↓',    osc: null,             fmt: null,               type: 'trigger' },
  { id: 'preset_cc',    label: 'preset (CC)',                key: '—',                 osc: '/preset',        fmt: 'int 1–N',          type: 'cc',
    ccFn: v => { const idx = Math.min(PRESETS.length - 1, Math.floor((v / 127) * PRESETS.length)); selectPreset(idx); } },

  // ── Spatial ────────────────────────────────────────────────────────────────
  { id: null, group: 'spatial' },
  { id: 'spatial_mode', label: 'spatial mode',              key: '—',                 osc: '/spatial/mode',  fmt: 'str sim|physical', type: 'trigger' },

  // ── Clouds ─────────────────────────────────────────────────────────────────
  { id: null, group: 'clouds' },
  { id: 'drop_cloud',   label: 'drop cloud',                key: '↓',                 osc: '/cloud/drop',    fmt: 'bang',             type: 'trigger' },
  { id: 'pickup_cloud', label: 'pick up cloud',             key: '↑',                 osc: '/cloud/pickup',  fmt: 'bang',             type: 'trigger' },

  // ── Paint ──────────────────────────────────────────────────────────────────
  { id: null, group: 'paint' },
  { id: 'paint1',       label: 'paint sample 1',            key: '1',                 osc: null,             fmt: null,               type: 'trigger' },
  { id: 'paint2',       label: 'paint sample 2',            key: '2',                 osc: null,             fmt: null,               type: 'trigger' },
  { id: 'paint3',       label: 'paint sample 3',            key: '3',                 osc: null,             fmt: null,               type: 'trigger' },
  { id: 'paint4',       label: 'paint sample 4',            key: '4',                 osc: null,             fmt: null,               type: 'trigger' },
  { id: 'paint5',       label: 'paint sample 5',            key: '5',                 osc: null,             fmt: null,               type: 'trigger' },
  { id: 'paint6',       label: 'paint sample 6',            key: '6',                 osc: null,             fmt: null,               type: 'trigger' },
  { id: 'paint7',       label: 'paint sample 7',            key: '7',                 osc: null,             fmt: null,               type: 'trigger' },
  { id: 'paint8',       label: 'paint sample 8',            key: '8',                 osc: null,             fmt: null,               type: 'trigger' },
  { id: 'paint9',       label: 'paint sample 9',            key: '9',                 osc: null,             fmt: null,               type: 'trigger' },

  // ── App ────────────────────────────────────────────────────────────────────
  { id: null, group: 'app' },
  { id: 'perf',         label: 'perf monitor',              key: 'P',                 osc: null,             fmt: null,               type: 'trigger' },
  { id: 'mapping',      label: 'open midi map',             key: 'M',                 osc: null,             fmt: null,               type: 'trigger' },
];

// MIDI mappings: { actionId → { type: 'cc'|'note', channel, number } }
let midiMappings = {};
let midiLearningId = null;
let midiAccess = null;

function loadMidiMappings() {
  try {
    const saved = localStorage.getItem('mubone_midi_map');
    if (saved) midiMappings = JSON.parse(saved);
  } catch(e) { midiMappings = {}; }
}

function saveMidiMappings() {
  try { localStorage.setItem('mubone_midi_map', JSON.stringify(midiMappings)); } catch(e) {}
}

export async function initMidi() {
  if (!navigator.requestMIDIAccess) return;
  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    refreshMidiInputs();
    midiAccess.onstatechange = refreshMidiInputs;
  } catch(e) {
    console.log('MIDI not available:', e.message);
  }
}

function refreshMidiInputs() {
  const inputs = [...midiAccess.inputs.values()];
  const portEl = document.getElementById('midiPortName');
  if (portEl) portEl.textContent = inputs.length ? inputs.map(i => i.name).join(', ') : '—';
  for (const input of inputs) {
    input.onmidimessage = handleMidiMessage;
  }
}

function handleMidiMessage(event) {
  const [status, num, val] = event.data;
  const type    = status >> 4;
  const channel = (status & 0xF) + 1;

  if (midiLearningId !== null) {
    const mapType = (type === 11) ? 'cc' : 'note';
    midiMappings[midiLearningId] = { type: mapType, channel, number: num };
    saveMidiMappings();
    const action = ACTIONS.find(a => a.id === midiLearningId);
    setMappingStatus(`mapped "${action?.label}" → ${mapType.toUpperCase()} ${num} ch${channel}`);
    midiLearningId = null;
    renderMappingTable();
    return;
  }

  for (const action of ACTIONS) {
    if (!action.id) continue;  // skip group headers
    const mapping = midiMappings[action.id];
    if (!mapping) continue;
    const matchCC   = mapping.type === 'cc'   && type === 11 && mapping.number === num && mapping.channel === channel;
    const matchNote = mapping.type === 'note' && type === 9  && mapping.number === num && mapping.channel === channel && val > 0;
    // For trigger-type actions mapped to CC, only fire on press (val > 0), not release
    if (matchCC && action.type === 'trigger' && val === 0) continue;
    if (matchCC || matchNote) {
      dispatchAction(action.id, matchCC ? val : 127);
    }
  }
}

function dispatchAction(id, midiVal) {
  switch(id) {
    case 'recpaint':
      if (midiVal > 0 && !S.isPainting) {
        // Press: start painting
        ensureAudioContext(); startLiveRecording();
        recordStrokeStart('live', S.currentLiveBufferIdx);
        S.isPainting = true; S.paintFrameCount = 0;
        S.updateLiveRecUI?.();
      } else if (midiVal === 0 && S.isPainting) {
        // Release: stop painting
        S.isPainting      = false;
        S.currentStrokeId = -1;
        if (S.isRecording) stopLiveRecording();
        S.liveColorIndex = (S.liveColorIndex + 1) % LIVE_PAINT_COLORS.length;
        S.updateLiveRecUI?.();
      }
      break;
    case 'record':
      S._setRecording?.(!S.isRecording);
      break;
    case 'mute':
      if (S._setMuted) S._setMuted(!S.isMuted);
      else S.isMuted = !S.isMuted;
      break;
    case 'cursor_mute':
      setCursorHouseMuted(!S.cursorHouseMuted);
      break;
    case 'undo':         undoLastStroke(); break;
    case 'drop_cloud':   dropCloud(); break;
    case 'pickup_cloud': pickupNearestCloud(); break;
    case 'snap':         toggleNearestMode(); break;
    case 'k_all':
      S.grainKAllMode = !S.grainKAllMode;
      updatePlaybackControls();
      break;
    case 'grain_dir': {
      const dirs = ['fwd', 'rev', 'rnd'];
      S.grainDirection = dirs[(dirs.indexOf(S.grainDirection) + 1) % dirs.length];
      S.syncGrainControlsUI?.();
      break;
    }
    case 'spatial_mode':
      if (S._setSpatialMode) S._setSpatialMode(S.spatialMode === 'sim' ? 'physical' : 'sim');
      break;
    case 'perf':
      S.perfMonitorVisible = !S.perfMonitorVisible;
      { const el = document.getElementById('perfMonitor'); if (el) el.style.display = S.perfMonitorVisible ? 'block' : 'none'; }
      break;
    case 'radius_dec':
      S.searchRadiusDeg = Math.max(SEARCH_RADIUS_MIN, S.searchRadiusDeg - SEARCH_RADIUS_STEP);
      updatePlaybackControls(); flashRadiusTooltip();
      break;
    case 'radius_inc':
      S.searchRadiusDeg = Math.min(SEARCH_RADIUS_MAX, S.searchRadiusDeg + SEARCH_RADIUS_STEP);
      updatePlaybackControls(); flashRadiusTooltip();
      break;
    case 'mapping':      openMappingModal(); break;
    case 'preset_next':  selectPreset((S.activePresetIndex + 1) % PRESETS.length); break;
    case 'preset_prev':  selectPreset((S.activePresetIndex - 1 + PRESETS.length) % PRESETS.length); break;
    default:
      if (id.startsWith('paint')) {
        const n = parseInt(id.replace('paint', ''));
        const idx = n - 1;
        if (idx < S.samples.length && S.samples[idx].buffer) {
          ensureAudioContext(); S.activeSampleIndex = idx;
          const s = S.samples[idx]; s.grainCursor = s.cropStart * s.duration;
          recordStrokeStart('sample'); S.isPainting = true; S.paintFrameCount = 0;
        }
      }
      // CC actions and any other actions dispatched via ccFn
      { const action = ACTIONS.find(a => a.id === id);
        if (action?.type === 'cc' && action.ccFn) action.ccFn(midiVal); }
      break;
  }
}

// ── Modal UI ─────────────────────────────────────────────────────────────────

function openMappingModal() {
  renderMappingTable();
  document.getElementById('mappingModal').classList.add('open');
}

function closeMappingModal() {
  midiLearningId = null;
  document.getElementById('mappingModal').classList.remove('open');
  setMappingStatus('');
  renderMappingTable();
}

function setMappingStatus(msg) {
  const el = document.getElementById('mappingStatus');
  if (el) el.textContent = msg;
}

function renderMappingTable() {
  const tbody = document.getElementById('mappingTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  for (const action of ACTIONS) {
    // ── Section header row ──────────────────────────────────────────────────
    if (!action.id) {
      const tr = document.createElement('tr');
      tr.className = 'mapping-group-header';
      const th = document.createElement('th');
      th.colSpan = 6;
      th.textContent = action.group;
      tr.appendChild(th);
      tbody.appendChild(tr);
      continue;
    }

    const mapping    = midiMappings[action.id];
    const isLearning = midiLearningId === action.id;

    const tr = document.createElement('tr');

    // Function name
    const tdName = document.createElement('td');
    tdName.className = 'fn-name';
    tdName.textContent = action.label;
    tr.appendChild(tdName);

    // Keyboard shortcut
    const tdKey = document.createElement('td');
    if (action.key && action.key !== '—') {
      const badge = document.createElement('span');
      badge.className = 'key-badge';
      badge.textContent = action.key;
      tdKey.appendChild(badge);
    } else {
      tdKey.textContent = '—';
      tdKey.style.color = '#444';
    }
    tr.appendChild(tdKey);

    // MIDI assignment
    const tdMidi = document.createElement('td');
    tdMidi.className = 'midi-cell' + (mapping ? '' : ' unassigned');
    if (mapping) {
      tdMidi.textContent = `${mapping.type.toUpperCase()} ${mapping.number} ch${mapping.channel}`;
    } else {
      tdMidi.textContent = 'unassigned';
    }
    tr.appendChild(tdMidi);

    // Learn / clear buttons — sits directly under "midi learn" header, next to midi col
    const tdBtn = document.createElement('td');
    tdBtn.style.whiteSpace = 'nowrap';

    const learnBtn = document.createElement('button');
    learnBtn.className = 'learn-btn' + (isLearning ? ' learning' : '');
    learnBtn.textContent = isLearning ? 'waiting…' : 'learn';
    learnBtn.addEventListener('click', () => {
      if (midiLearningId === action.id) {
        midiLearningId = null;
        setMappingStatus('');
      } else {
        midiLearningId = action.id;
        setMappingStatus(`move a midi control to assign "${action.label}"…`);
        if (!midiAccess) initMidi().then(refreshMidiInputs);
      }
      renderMappingTable();
    });
    tdBtn.appendChild(learnBtn);

    if (mapping) {
      const clearBtn = document.createElement('button');
      clearBtn.className = 'clear-midi-btn';
      clearBtn.textContent = '✕';
      clearBtn.title = 'clear midi assignment';
      clearBtn.addEventListener('click', () => {
        delete midiMappings[action.id];
        saveMidiMappings();
        renderMappingTable();
      });
      tdBtn.appendChild(clearBtn);
    }
    tr.appendChild(tdBtn);

    // OSC path
    const tdOsc = document.createElement('td');
    tdOsc.className = 'osc-path';
    if (action.osc) {
      const badge = document.createElement('span');
      badge.className = 'osc-badge';
      badge.textContent = action.osc;
      tdOsc.appendChild(badge);
    } else {
      tdOsc.textContent = '—';
      tdOsc.style.color = '#444';
    }
    tr.appendChild(tdOsc);

    // Data format
    const tdFmt = document.createElement('td');
    tdFmt.className = 'osc-fmt';
    if (action.fmt) {
      tdFmt.textContent = action.fmt;
    } else {
      tdFmt.textContent = '—';
      tdFmt.style.color = '#444';
    }
    tr.appendChild(tdFmt);
    tbody.appendChild(tr);
  }
}

// ── Modal setup (called from init) ───────────────────────────────────────────

export function setupMappingModal() {
  loadMidiMappings();

  // Patch recency CC fn to also redraw the dial
  const recEntry = ACTIONS.find(a => a.id === 'recency_cc');
  if (recEntry) {
    const orig = recEntry.ccFn;
    recEntry.ccFn = v => { orig(v); S.drawRecencyDial?.(); };
  }

  document.getElementById('mappingClose')?.addEventListener('click', closeMappingModal);
  document.getElementById('mappingModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('mappingModal')) closeMappingModal();
  });
  document.getElementById('clearAllMidi')?.addEventListener('click', () => {
    midiMappings = {};
    saveMidiMappings();
    renderMappingTable();
    setMappingStatus('all midi mappings cleared');
  });

  // Expose modal open/close via S so events.js and ui-presets.js can call them
  S.openMappingModal  = openMappingModal;
  S.closeMappingModal = closeMappingModal;

  // Save as default button
  wireSaveDefaultBtn('mappingSaveDefaultsBtn');
}
