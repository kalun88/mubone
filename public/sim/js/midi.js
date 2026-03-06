// ============================================================================
// MIDI + KEYBOARD MAPPING SYSTEM
// ============================================================================

import {
  S,
  PRESETS, SEARCH_RADIUS_MIN, SEARCH_RADIUS_MAX, SEARCH_RADIUS_STEP,
  LIVE_PAINT_COLORS,
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

// Each action definition: { id, label, key, fn, type }
// type: 'trigger' | 'cc' (continuous 0-127)
const ACTIONS = [
  { id: 'recpaint',    label: 'rec + paint (hold)',  key: 'click / space', type: 'hold' },
  { id: 'undo',        label: 'undo last stroke',     key: 'right click / ⌘Z', type: 'trigger' },
  { id: 'drop_cloud',  label: 'drop cloud',           key: '↓', type: 'trigger' },
  { id: 'pickup_cloud',label: 'pick up cloud',        key: '↑', type: 'trigger' },
  { id: 'snap',        label: 'toggle snap/nearest',  key: 'N', type: 'trigger' },
  { id: 'perf',        label: 'toggle perf monitor',  key: 'P', type: 'trigger' },
  { id: 'paint1',      label: 'paint sample 1',       key: '1', type: 'trigger' },
  { id: 'paint2',      label: 'paint sample 2',       key: '2', type: 'trigger' },
  { id: 'paint3',      label: 'paint sample 3',       key: '3', type: 'trigger' },
  { id: 'paint4',      label: 'paint sample 4',       key: '4', type: 'trigger' },
  { id: 'paint5',      label: 'paint sample 5',       key: '5', type: 'trigger' },
  { id: 'paint6',      label: 'paint sample 6',       key: '6', type: 'trigger' },
  { id: 'paint7',      label: 'paint sample 7',       key: '7', type: 'trigger' },
  { id: 'paint8',      label: 'paint sample 8',       key: '8', type: 'trigger' },
  { id: 'paint9',      label: 'paint sample 9',       key: '9', type: 'trigger' },
  { id: 'radius_dec',  label: 'radius decrease',      key: 'scroll down / [', type: 'trigger' },
  { id: 'radius_inc',  label: 'radius increase',      key: 'scroll up / ]',   type: 'trigger' },
  { id: 'radius_cc',   label: 'radius (continuous)',  key: '—', type: 'cc',
    ccFn: v => { S.searchRadiusDeg = SEARCH_RADIUS_MIN + (v / 127) * (SEARCH_RADIUS_MAX - SEARCH_RADIUS_MIN); updatePlaybackControls(); flashRadiusTooltip(); } },
  { id: 'recency_cc',  label: 'recency N (continuous)', key: '—', type: 'cc',
    ccFn: v => { S.recencyN = 1 + Math.round((v / 127) * 15); document.getElementById('recencyVal').textContent = S.recencyN; } },
  { id: 'preset_cc',   label: 'preset select (CC)',   key: '—', type: 'cc',
    ccFn: v => { const idx = Math.min(PRESETS.length - 1, Math.floor((v / 127) * PRESETS.length)); selectPreset(idx); } },
  { id: 'preset_next', label: 'preset next',           key: 'shift+scroll ↓', type: 'trigger' },
  { id: 'preset_prev', label: 'preset prev',           key: 'shift+scroll ↑', type: 'trigger' },
  { id: 'mapping',     label: 'open midi map',        key: 'M', type: 'trigger' },
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
    case 'undo':        undoLastStroke(); break;
    case 'drop_cloud':  dropCloud(); break;
    case 'pickup_cloud':pickupNearestCloud(); break;
    case 'snap':        toggleNearestMode(); break;
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
      // CC actions dispatched via ccFn
      const action = ACTIONS.find(a => a.id === id);
      if (action?.type === 'cc' && action.ccFn) action.ccFn(midiVal);
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
    const mapping    = midiMappings[action.id];
    const isLearning = midiLearningId === action.id;

    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.className = 'fn-name';
    tdName.textContent = action.label;
    tr.appendChild(tdName);

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

    const tdMidi = document.createElement('td');
    tdMidi.className = 'midi-cell' + (mapping ? '' : ' unassigned');
    if (mapping) {
      tdMidi.textContent = `${mapping.type.toUpperCase()} ${mapping.number} ch${mapping.channel}`;
    } else {
      tdMidi.textContent = 'unassigned';
    }
    tr.appendChild(tdMidi);

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
}
