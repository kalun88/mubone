// ============================================================================
// live-loop.js — #209 prototype: main-thread handle for the live-loop worklet.
//
// Reached by dynamic import from js/tiles.js (_startLiveHold — the 1+Q
// growing-loop gesture). Also loadable from the DevTools console or a rig
// harness:
//
//   const { createLiveLoop } = await import('./js/live-loop.js');
//   const ll = await createLiveLoop();          // taps S.inputAnalyser
//   ll.record();                                //  `1` goes down — painting
//   ll.loop();                                  //  `Q` goes down — loop the stroke so far
//   ll.close();                                 //  either key up — whole stroke is the loop
//   ll.stop(); ll.dispose();
//
// The DSP, the wrap rule and the seam strategy live in
// js/worklets/live-loop.worklet.js — read its header first. This file is only
// plumbing: node creation, routing, and a promise-wrapped message port.
// ============================================================================

import { S } from './state.js';
import { ensureAudioContext } from './audio.js';

/**
 * Create a live-loop node.
 *
 * opts.input       — AudioNode to record from. Default S.inputAnalyser (the
 *                    same tap recording-capture uses). Pass an oscillator or
 *                    buffer source for deterministic tests.
 * opts.destination — AudioNode to play into. Default the house bus if one
 *                    exists, else the context destination.
 * opts.capture     — record the node's own output inside the worklet, for
 *                    seam analysis via dump(). Diagnostics only.
 * opts.minLoopS    — minimum material before the first pass begins (default
 *                    0.5 s — see the 'loop' case in the worklet).
 * opts.xfadeS      — seam crossfade (default 0.030 s, matching
 *                    buildLoopPayload's baked value).
 * opts.gain        — output gain (default 1; harnesses use 0 to run silent).
 */
export async function createLiveLoop(opts = {}) {
  const actx = ensureAudioContext();
  if (actx.state !== 'running') await actx.resume();

  // addModule is idempotent per URL (module map), so repeated createLiveLoop
  // calls are safe.
  await actx.audioWorklet.addModule('js/worklets/live-loop.worklet.js');

  const node = new AudioWorkletNode(actx, 'live-loop', {
    numberOfInputs:   1,
    numberOfOutputs:  1,
    outputChannelCount: [1],
    channelCount:     1,
    channelCountMode: 'explicit',
  });

  node.port.postMessage({
    type: 'config',
    minLoopS:    opts.minLoopS,
    xfadeS:      opts.xfadeS,
    initialBufS: opts.initialBufS,
    capture:     !!opts.capture,
  });

  const input = opts.input !== undefined ? opts.input : S.inputAnalyser;
  if (input) input.connect(node);

  const outGain = actx.createGain();
  outGain.gain.value = opts.gain ?? 1;
  node.connect(outGain);
  const dest = opts.destination || S.houseBus || actx.destination;
  outGain.connect(dest);

  // A worklet node only runs if its output reaches a rendering sink, and
  // S.houseBus does not reach one until an output device is selected (the
  // multichannel capture chain is wired on device selection, not at startup).
  // A zero-gain tap to the context destination keeps the node pulled — and
  // therefore recording — whatever the routing state. Found the hard way on
  // the audit instance: everything responded, writePos stayed at 0.
  const keepAlive = actx.createGain();
  keepAlive.gain.value = 0;
  node.connect(keepAlive);
  keepAlive.connect(actx.destination);

  // One in-flight request per reply type is all the prototype needs.
  const pending = new Map();
  node.port.onmessage = ({ data }) => {
    const r = pending.get(data?.type);
    if (r) { pending.delete(data.type); r(data); }
  };
  const request = (type) => new Promise(res => {
    pending.set(type, res);
    node.port.postMessage({ type });
  });

  return {
    node,
    outGain,
    record()      { node.port.postMessage({ type: 'record' }); },
    loop()        { node.port.postMessage({ type: 'loop' }); },
    /** Hand over material recorded before this node existed — the stroke so
     *  far at Q-press. `samples` is copied by the caller; transferred here. */
    preload(samples) { node.port.postMessage({ type: 'preload', samples }, [samples.buffer]); },
    close()       { node.port.postMessage({ type: 'close' }); },
    stop()        { node.port.postMessage({ type: 'stop' }); },
    setSpeed(v)   { node.port.postMessage({ type: 'speed', value: v }); },
    getState()    { return request('state'); },
    dump()        { return request('dump'); },
    dispose() {
      try { input && input.disconnect(node); } catch (_) {}
      try { node.disconnect(); } catch (_) {}
      try { outGain.disconnect(); } catch (_) {}
      try { keepAlive.disconnect(); } catch (_) {}
      node.port.onmessage = null;
    },
  };
}
