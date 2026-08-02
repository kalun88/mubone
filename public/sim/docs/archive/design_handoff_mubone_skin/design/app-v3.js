// v2 app: Ableton-style rack layout with knobs
(function () {
  const LS_ORDER = 'mubone_v2_rack_order';
  const LS_COLLAPSED = 'mubone_v2_rack_collapsed';

  const RACKS = [
    { key: 'patches',        label: 'patches',         hint: 'source sounds · bank a/b/c' },
    { key: 'grain',          label: 'grain',           hint: 'granulation engine' },
    { key: 'cursor-search',  label: 'cursor + search', hint: 'movement · k-nearest · commit' },
    { key: 'commits',        label: 'commits',         hint: 'saved cloud states · dsp bus' },
  ];
  const RACK_KEYS = RACKS.map(r => r.key);

  const rackStack = document.getElementById('rackStack');

  function loadOrder() {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_ORDER) || 'null');
      if (Array.isArray(saved) && saved.length) {
        const known = saved.filter(k => RACK_KEYS.includes(k));
        RACK_KEYS.forEach(k => { if (!known.includes(k)) known.push(k); });
        return known;
      }
    } catch {}
    return [...RACK_KEYS];
  }
  function saveOrder(o) { localStorage.setItem(LS_ORDER, JSON.stringify(o)); }
  function loadCollapsed() {
    try { return new Set(JSON.parse(localStorage.getItem(LS_COLLAPSED) || '[]')); }
    catch { return new Set(); }
  }
  function saveCollapsed(s) { localStorage.setItem(LS_COLLAPSED, JSON.stringify([...s])); }

  let order = loadOrder();
  let collapsed = loadCollapsed();

  /* ── Primitive builders ──────────────────────────────────────── */

  // Knob — small rotary with SVG dial.
  //   pct: 0..100 fill percentage
  //   label / value: text labels
  //   tone: '' | 'accent' (teal) | 'warm' (amber)
  //   bipolar: dial centered (e.g. pitch ±)
  function knob(label, pct, value, opts = {}) {
    const tone = opts.tone || '';
    const bipolar = opts.bipolar || false;
    // Arc from 0% (bottom-left) to 100% (bottom-right), 270° sweep
    // We're drawing with rotate(-135deg) so start at 135° CCW.
    const r = 12;
    const cx = 15, cy = 15;
    const circumference = 2 * Math.PI * r;
    const sweep = circumference * 0.75; // 3/4 of full circle visible
    // full track:
    const trackDasharray = `${sweep} ${circumference - sweep}`;
    // fill arc:
    let fillLen, fillOffset;
    if (bipolar) {
      // center is 50%; show from center outward
      const dev = Math.abs(pct - 50) / 50; // 0..1
      fillLen = (sweep / 2) * dev;
      // offset from the arc start (which is 0%), we want to draw from center (50%) outward
      // If pct >= 50: start at middle, draw rightward
      // If pct < 50: start before middle, draw to middle
      if (pct >= 50) fillOffset = -(sweep * 0.5);
      else fillOffset = -(sweep * 0.5 - fillLen);
    } else {
      fillLen = sweep * (pct / 100);
      fillOffset = 0;
    }
    const fillDasharray = `${fillLen} ${circumference - fillLen}`;
    const strokeColor = tone === 'accent' ? 'var(--teal)' : tone === 'warm' ? 'var(--amber)' : 'var(--ink-6)';
    // Indicator tick at the current position
    const tickAngle = 135 + (pct / 100) * 270; // in rotated-SVG space, 0=bottom-left
    // Because our SVG is rotated -135deg, a 0-deg tick at 135 = bottom; we'll draw tick via rotate
    const tickTransform = `rotate(${(pct / 100) * 270 - 135}, ${cx}, ${cy})`;
    return `
      <div class="knob ${tone ? tone : ''} ${opts.locked ? 'locked' : ''}">
        <div class="kl">${label}</div>
        <div class="kdial">
          <svg viewBox="0 0 30 30">
            <circle cx="${cx}" cy="${cy}" r="${r}"
              fill="none" stroke="var(--ink-2)" stroke-width="2"
              stroke-dasharray="${trackDasharray}" stroke-linecap="round"/>
            ${pct > 0 || bipolar ? `
            <circle cx="${cx}" cy="${cy}" r="${r}"
              fill="none" stroke="${strokeColor}" stroke-width="2"
              stroke-dasharray="${fillDasharray}"
              stroke-dashoffset="${fillOffset}"
              stroke-linecap="round"/>
            ` : ''}
            <g transform="${tickTransform}">
              <line x1="${cx}" y1="${cy - r + 2}" x2="${cx}" y2="${cy - r + 6}"
                stroke="${tone === 'accent' ? 'var(--teal)' : tone === 'warm' ? 'var(--amber)' : 'var(--ink-7)'}"
                stroke-width="1.5" stroke-linecap="round"/>
            </g>
          </svg>
        </div>
        <div class="kvalue">${value}</div>
      </div>
    `;
  }

  function vslider(label, pct, value, tone = '') {
    const color = tone === 'accent' ? 'var(--teal)' : tone === 'warm' ? 'var(--amber)' : 'var(--ink-6)';
    return `
      <div class="vslider">
        <div class="kl">${label}</div>
        <div class="vtrack"><div class="vfill" style="--val: ${pct}%; background: ${color};"></div></div>
        <div class="kvalue">${value}</div>
      </div>
    `;
  }

  function pill(label, opts, attrs = {}) {
    return `
      <div class="pill-row" ${attrs.cls ? `class="${attrs.cls}"` : ''}>
        <span class="pk">${label}</span>
        <div class="pill">${opts.map(o => `<button class="${o.on ? 'on' : ''}">${o.t}</button>`).join('')}</div>
      </div>
    `;
  }

  const actBtn = (glyph, label, kb, cls = '') =>
    `<button class="act-btn ${cls}"><span class="gl">${glyph}</span><span>${label}</span>${kb?`<span class="ak">${kb}</span>`:''}</button>`;

  const knobs = (arr) => `<div class="knobs">${arr.join('')}</div>`;

  /* ── Rack bodies ─────────────────────────────────────────────── */

  function bodyForPatches() {
    // 40 slots total (2 rows of 20)
    const named = [
      'wash','bell','bell decay','grit','freeze','glass','choir','swarm','breath','reverse',
      'dust','drone',
    ];
    const patches = Array.from({length: 40}, (_, i) => {
      const n = named[i];
      const idx = String(i + 1).padStart(2, '0');
      return n
        ? { i: idx, n, on: i === 2, dirty: i === 2 }
        : { i: idx, n: '—', empty: true };
    });
    return `
      <div class="dv dv-patches">
        <div class="dv-head"><span>40 patches · bank A</span><span class="tag">12 full · 28 empty</span></div>
        <div class="patches-strip">
          ${patches.map(p => `
            <div class="patch ${p.on?'on':''} ${p.dirty?'dirty':''} ${p.empty?'empty':''}" title="${p.n}">
              <span class="idx">${p.i}</span>
              <span class="nm">${p.n}</span>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="dv dv-stats">
        <div class="dv-head">current · 03</div>
        <div class="stats-list">
          <div class="s"><span class="sk">dur</span><span class="sv">180 ms</span></div>
          <div class="s"><span class="sk">per</span><span class="sv">160 ms</span></div>
          <div class="s"><span class="sk">k</span><span class="sv">12</span></div>
          <div class="s"><span class="sk">pan</span><span class="sv">60%</span></div>
          <div class="s"><span class="sk">vol</span><span class="sv">−6.0</span></div>
          <div class="s"><span class="sk">since</span><span class="sv">2:51</span></div>
        </div>
      </div>
    `;
  }

  function bodyForGrain() {
    return `
      <div class="dv dv-env">
        <div class="dv-head"><span>envelope</span><span class="tag">hann</span></div>
        <div class="env-canvas">
          <span class="env-label">hann · 25% fade</span>
          <svg viewBox="0 0 200 60" preserveAspectRatio="none">
            <line x1="0" y1="55" x2="200" y2="55" stroke="rgba(255,255,255,0.08)"/>
            <path d="M 0 55 C 40 55, 55 8, 100 8 C 145 8, 160 55, 200 55 Z" fill="rgba(122,188,188,0.14)" stroke="#9dd6d6" stroke-width="1.4"/>
            <line x1="100" y1="0" x2="100" y2="60" stroke="#f5c56d" stroke-dasharray="2 2" stroke-width="1"/>
          </svg>
        </div>
        <div class="env-stats">
          <span>dur <b>180</b>ms</span>
          <span>per <b>160</b>ms</span>
          <span>ovl <b>1.12×</b></span>
        </div>
      </div>

      <div class="grain-rows">
        <div class="grain-row">
          <div class="grp">
            <div class="grp-head">timing</div>
            ${knobs([
              knob('dur', 42, '180ms', {tone:'accent'}),
              knob('period', 38, '160ms', {tone:'accent'}),
              knob('overlap', 56, '1.12×', {locked:true}),
              knob('fade', 50, '25%'),
            ])}
          </div>
          <div class="grp is-adv">
            <div class="grp-head">jitter</div>
            ${knobs([
              knob('dur±', 8, '12ms'),
              knob('per±', 4, '6ms'),
              knob('jit', 18, '18%'),
            ])}
          </div>
          <div class="grp">
            <div class="grp-head">pitch</div>
            ${knobs([
              knob('pitch', 50, '0¢', {tone:'warm', bipolar:true}),
              knob('range', 14, '±98¢', {tone:'warm'}),
              knob('prob', 100, '100%'),
              knob('spread', 60, '60%'),
            ])}
          </div>
          <div class="grp is-adv">
            <div class="grp-head">filter</div>
            ${knobs([
              knob('hpf', 12, '82Hz'),
              knob('lpf', 78, '6.4k'),
              knob('Q', 10, '0.71'),
            ])}
          </div>
          <div class="grp">
            <div class="grp-head">amp</div>
            ${knobs([
              knob('vol', 50, '0.50', {tone:'accent'}),
            ])}
            <div style="display:flex; flex-direction:column; gap:2px; margin-top:4px;">
              ${pill('dir', [{t:'▶',on:true},{t:'◀'},{t:'⇄'}])}
              ${pill('src', [{t:'mic',on:true},{t:'buf'},{t:'mix'}])}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function bodyForCursorSearch() {
    return `
      <div class="dv dv-cursor-mode">
        <div class="dv-head">cursor mode</div>
        ${pill('fade', [{t:'on'},{t:'off',on:true}])}
        ${pill('azimuth', [{t:'free',on:true},{t:'lock'}])}
        ${pill('elev', [{t:'free',on:true},{t:'lock'}])}
        ${pill('tare', [{t:'off',on:true},{t:'hold'},{t:'on'}])}
      </div>

      <div class="dv dv-search">
        <div class="dv-head"><span>search</span><span class="tag">k=12 · 24°</span></div>
        <div class="search-knobs-row">
          ${knobs([
            knob('k', 55, '12', {tone:'accent', locked:true}),
            knob('radius', 15, '24°'),
            knob('recency', 20, '3', {}),
            knob('weight', 50, '0.50', {}),
          ])}
          <div class="pill-stack">
            ${pill('scope', [{t:'area',on:true},{t:'nearest'}])}
            ${pill('order', [{t:'rand',on:true},{t:'step'}])}
            ${pill('fill', [{t:'k',on:true},{t:'all'}])}
          </div>
        </div>
      </div>
    `;
  }

  function bodyForCommits() {
    return `
      <div class="dv dv-behavior">
        <div class="dv-head">behavior</div>
        ${pill('mode', [{t:'cloud',on:true},{t:'loop'}])}
        ${pill('select', [{t:'nearest',on:true},{t:'far'}])}
        ${pill('trigger', [{t:'once',on:true},{t:'latch'}])}
        ${pill('voices', [{t:'poly',on:true},{t:'mono'}])}
      </div>

      <div class="dv dv-timing">
        <div class="dv-head">commit dsp</div>
        ${knobs([
          knob('vol', 50, '0.72', {tone:'accent'}),
          knob('decay', 40, '24s'),
          knob('xfade', 28, '280ms'),
          knob('attack', 8, '80ms'),
          knob('release', 32, '320ms'),
        ])}
      </div>

      <div class="dv dv-send">
        <div class="dv-head">send</div>
        ${knobs([
          knob('rev', 35, '0.35'),
          knob('dly', 20, '0.20'),
          knob('drive', 10, '0.10'),
        ])}
      </div>
    `;
  }

  const BODY_BUILDERS = {
    'patches':       bodyForPatches,
    'grain':         bodyForGrain,
    'cursor-search': bodyForCursorSearch,
    'commits':       bodyForCommits,
  };

  /* ── Render ──────────────────────────────────────────────────── */

  function renderRack(rackDef, idx, total) {
    const el = document.createElement('div');
    el.className = 'rack' + (collapsed.has(rackDef.key) ? ' collapsed' : '');
    el.dataset.rack = rackDef.key;
    el.innerHTML = `
      <div class="rack-head" draggable="true">
        <div class="rack-head-l">
          <button class="strip-collapse" title="collapse / expand">${collapsed.has(rackDef.key) ? '▸' : '▾'}</button>
          <div class="rack-head-label">${rackDef.label}</div>
          <div class="rack-head-hint">${rackDef.hint || ''}</div>
        </div>
        <div class="rack-head-r">
          <button class="strip-up" title="move up" ${idx === 0 ? 'disabled' : ''}>▲</button>
          <button class="strip-dn" title="move down" ${idx === total - 1 ? 'disabled' : ''}>▼</button>
        </div>
      </div>
      <div class="rack-body">
        ${BODY_BUILDERS[rackDef.key]()}
      </div>
    `;
    el.querySelector('.strip-collapse').addEventListener('click', (e) => {
      e.stopPropagation();
      if (collapsed.has(rackDef.key)) collapsed.delete(rackDef.key);
      else collapsed.add(rackDef.key);
      saveCollapsed(collapsed);
      render();
    });
    el.querySelector('.strip-up').addEventListener('click', (e) => { e.stopPropagation(); move(rackDef.key, -1); });
    el.querySelector('.strip-dn').addEventListener('click', (e) => { e.stopPropagation(); move(rackDef.key, +1); });

    const strip = el.querySelector('.rack-head');
    strip.addEventListener('dragstart', (e) => {
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', rackDef.key);
    });
    strip.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromKey = e.dataTransfer.getData('text/plain');
      if (!fromKey || fromKey === rackDef.key) return;
      const from = order.indexOf(fromKey);
      const to = order.indexOf(rackDef.key);
      if (from < 0 || to < 0) return;
      const [k] = order.splice(from, 1);
      order.splice(to, 0, k);
      saveOrder(order);
      render();
    });
    return el;
  }

  function move(key, dir) {
    const i = order.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    order.splice(j, 0, order.splice(i, 1)[0]);
    saveOrder(order);
    render();
  }

  function render() {
    rackStack.innerHTML = '';
    order.forEach((key, i) => {
      const def = RACKS.find(r => r.key === key);
      if (!def) return;
      rackStack.appendChild(renderRack(def, i, order.length));
    });
  }

  document.querySelectorAll('#modeSwitch button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#modeSwitch button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      document.body.dataset.mode = b.dataset.mode;
    });
  });

  /* ── Stage resize handle ──────────────────────────────────────── */
  (function initStageResize() {
    const handle = document.getElementById('stageResize');
    const main = document.getElementById('main');
    if (!handle || !main) return;
    const LS_H = 'mubone:v3:stageH';

    // Min ≥ 1/3 viewport, max 70%
    const minH = () => Math.max(260, Math.round(window.innerHeight * 0.34));
    const maxH = () => Math.round(window.innerHeight * 0.72);

    try {
      const saved = parseInt(localStorage.getItem(LS_H), 10);
      if (!isNaN(saved)) main.style.setProperty('--stage-h', Math.max(minH(), Math.min(maxH(), saved)) + 'px');
    } catch {}

    let dragging = false, startY = 0, startH = 0;
    handle.addEventListener('pointerdown', (e) => {
      dragging = true;
      startY = e.clientY;
      const cs = getComputedStyle(main);
      const rows = cs.gridTemplateRows.split(' ');
      startH = parseFloat(rows[0]) || minH();
      handle.classList.add('dragging');
      document.body.classList.add('stage-resizing');
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dy = e.clientY - startY;
      const h = Math.max(minH(), Math.min(maxH(), startH + dy));
      main.style.setProperty('--stage-h', h + 'px');
    });
    const stop = (e) => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.classList.remove('stage-resizing');
      try {
        const cs = getComputedStyle(main);
        const rows = cs.gridTemplateRows.split(' ');
        const h = parseFloat(rows[0]);
        if (!isNaN(h)) localStorage.setItem(LS_H, String(Math.round(h)));
      } catch {}
      try { handle.releasePointerCapture(e.pointerId); } catch {}
    };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  })();

  render();
})();
