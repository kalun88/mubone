// ============================================================================
// TAKE — a recording's samples, held ONCE
//
// A take is `{ data, sampleRate, length, duration }` with `data` a
// Float32Array over a SharedArrayBuffer. The grain worklet reads the same
// memory the main thread reads (the waveform, onsets, a loop's region, the
// save), so a live take costs one copy, not an AudioBuffer here plus a
// Float32Array there — and an erase or an undo moves nothing: the worklet
// drops or re-takes a reference. The engine already refuses to start without
// SharedArrayBuffer, so nothing new is required of the host.
//
// A source node cannot play shared memory, so tape playback copies the
// region it plays into an AudioBuffer of its own: a pinned loop at pin time
// (buildLoopPayload), a trigger and a reversed loop lazily on the slot
// (grain.js _regionCopy), the sampler's monitor while the pedal is held.
// Copy INTO an AudioBuffer with `getChannelData(0).set`, never
// `copyToChannel`, which rejects a shared-memory view.
// ============================================================================

/** One take from a run of samples: allocates the shared memory and copies once. */
export function makeTake(samples, sampleRate) {
  const length = samples.length;
  const data = new Float32Array(new SharedArrayBuffer(length * Float32Array.BYTES_PER_ELEMENT));
  data.set(samples);
  return { data, sampleRate, length, duration: length / sampleRate };
}

/** A take copied into an AudioBuffer — for what only a source node can play
 *  (a pinned loop's region, restored from a piece). */
export function audioBufferOf(take, actx) {
  const buf = actx.createBuffer(1, Math.max(1, take.length), take.sampleRate);
  buf.getChannelData(0).set(take.data);
  return buf;
}

/** A decoded file as a take. Channel 0 only — the instrument is mono. */
export function takeFromAudioBuffer(audioBuffer) {
  return makeTake(audioBuffer.getChannelData(0), audioBuffer.sampleRate);
}
