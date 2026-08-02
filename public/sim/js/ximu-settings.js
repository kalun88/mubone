// ============================================================================
// ximu-settings.js — the enforced x-IMU3 device configuration, in one place.
//
// mubone does not trust whatever the x-IMU3 GUI or a Max patch last wrote to
// the device.  Every connect re-asserts this table, then reads it back and
// warns about anything that didn't take.  See docs/XIMU3-SETTINGS.md.
//
// THIS FILE MUST NOT IMPORT ANYTHING.  It is loaded two ways:
//   - js/imu-setup.js       — browser ES module, static import
//   - proxy.js              — Node CommonJS, dynamic await import()
// Adding an import (even ./state.js) breaks the Node side.
//
// Section references are x-IMU3 User Manual v1.11 (April 3, 2025).
// ============================================================================

// ── What mubone actually consumes ───────────────────────────────────────────
// Only two ASCII data message types reach live code:
//
//   Q  quaternion        → the cursor.  The entire spatial path depends on it.
//   S  serial accessory  → SA-A8 pots / sliders / buttons.  Fixed 100 Hz, not
//                          rate-divisor controlled; gated by `serial_mode` = 2,
//                          which is enforced below like everything else.
//
// Everything else the device can emit — inertial, magnetometer, high-g,
// temperature, battery, RSSI — is either parsed and then never read, or falls
// straight through parseDataLine's `default` case.  Battery and RSSI still
// reach the UI, but via the discovery announcement, which is a separate
// channel from data messages and unaffected by the divisors below.

export const ENFORCED_SETTINGS = {
  // ── AHRS output ───────────────────────────────────────────────────────────
  // §11.1.67 — 0 = quaternion.  Selecting one AHRS message type disables the
  // others, so this is also what keeps Euler ('A') messages off the wire.
  ahrs_message_type: 0,

  // §11.1.70 — 400 Hz sample rate / 4 = 100 messages per second.  Comfortably
  // above the paint ticker's 200 Hz consumption, and §9.3 means each message is
  // the average of the 4 most recent samples rather than a decimated one — free
  // anti-aliasing.  Divisor 1 (400 Hz) buys nothing and costs 4× the WiFi.
  ahrs_message_rate_divisor: 4,

  // §11.1.61 — 0 = NWU (North-West-Up).  Every Euler transform in imu-setup.js
  // assumes NWU.  Left unenforced, an ENU or NED setting from the GUI breaks
  // the cursor silently, with no error anywhere.
  ahrs_axes_convention: 0,

  // §11.1.62 — accelerometer correction strength.  Pinned so the device's feel
  // can't drift with whatever the GUI last had.  0.5 is the factory default;
  // this is the number to change if the cursor feels sluggish or twitchy.
  ahrs_gain: 0.5,

  // §11.1.63 — no magnetic heading reference.  Mag is unusable next to speakers,
  // laptops and stage metal.  Yaw drifts instead, corrected by tare / heading zero.
  ahrs_ignore_magnetometer: true,

  // §11.1.64 — reject dynamic acceleration so fast playing can't corrupt pitch/roll.
  ahrs_acceleration_rejection_enabled: true,

  // §11.1.60 — continuous gyro bias estimation.  Essential for drift.
  gyroscope_offset_correction_enabled: true,

  // §11.1.59 — 0 = +X+Y+Z.  All mount remapping stays in mubone software
  // (polarity / roll mute in imu-setup.js) so it can be changed live.
  axes_alignment: 0,

  // §11.1.66 — device default is binary (true).  mubone's parser only speaks
  // ASCII; a sensor left in binary hands over silently-broken frames.
  binary_mode_enabled: false,

  // §11.1.18 — 2 = Accessory.  Governs the serial UART on the expansion
  // connector, where the SA-A8 lives.  NOT the USB CDC port a `serial`
  // transport device connects through — the manual keeps those separate
  // (§11.1.75 USB vs §11.1.76 serial data messages, plus serial_baud_rate and
  // serial_rts_cts_enabled, which are UART-only concepts).  So enforcing this
  // can never threaten mubone's own connection.
  //
  // Enforced unconditionally, whether or not an accessory is currently
  // attached: SA-A8s get swapped between hosts mid-show as part of the
  // performance, so every x-imu3 has to be standing ready to receive one.
  // `apply` is enough to make it take effect (§8.1.4) — no `save`, no EEPROM
  // write.  accessory-registry.setAccessoryMode() still exists for writing it
  // with `save` by hand, but connect no longer depends on anyone having done so.
  serial_mode: 2,

  // ── Message types mubone does not consume ────────────────────────────────
  // §9.2: "A message rate divisor of 0 will disable the sending of that data
  // message type."  Nothing below is read by live code.
  //
  // Inertial in particular: parseDataLine used to fill dev.rawInertial from 'I'
  // messages, but feedToRegistry() only ever forwards the quaternion, so the
  // gesture and seed-morph engines never saw it on a direct connection.  Those
  // run off the Max/OSC path (/sensor/{name}/inertial), which is unaffected by
  // this table.  If direct-connect gesture is ever wired up, set this to 8
  // (50 Hz) and make feedToRegistry() call handleSlotInertial().
  inertial_message_rate_divisor: 0,             // §11.1.68
  magnetometer_message_rate_divisor: 0,         // §11.1.69 — AHRS ignores mag anyway
  high_g_accelerometer_message_rate_divisor: 0, // §11.1.71
  temperature_message_rate_divisor: 0,          // §11.1.72
  battery_message_rate_divisor: 0,              // §11.1.73 — battery UI uses discovery
  rssi_message_rate_divisor: 0,                 // §11.1.74 — RSSI UI uses discovery
};

// ── Transport-specific overlay ──────────────────────────────────────────────
// Applied on top of ENFORCED_SETTINGS for UDP devices only.
export const UDP_SETTINGS = {
  // §11.1.45 — false.  Low latency sends each data message as its own UDP
  // packet, which the manual notes "will significantly limit the maximum
  // throughput and number of devices able to stream on the same network".
  // mubone runs 3+ sensors on one network (docs/MULTI-INSTANCE-PLAN.md), so
  // packet aggregation is worth more than the few ms.  Flip to true only for a
  // single-sensor rig where latency is the whole game.
  udp_low_latency: false,
};

// The settings to enforce on a device, given its transport ('udp' | 'serial').
export function settingsFor(transport) {
  return transport === 'udp'
    ? { ...ENFORCED_SETTINGS, ...UDP_SETTINGS }
    : { ...ENFORCED_SETTINGS };
}

// Data message type letters mubone tolerates.  Anything else arriving on a
// direct transport means enforcement did not take — see the unexpected-type
// counter in imu-setup.js parseDataLine().
//
//   Q  quaternion       — the cursor
//   S  serial accessory — SA-A8
//   A  Euler angles     — only appears after a manual requestEulerMode() from
//                         the DevTools console.  Listed so that debugging
//                         session doesn't trip the warning.
export const EXPECTED_MESSAGE_TYPES = ['Q', 'S', 'A'];

// How long to wait for read-back responses before declaring a key unverified.
// UDP command responses are unacknowledged and can simply be lost, so a missing
// response is reported separately from an actual mismatch.
export const VERIFY_TIMEOUT_MS = 1500;

// Delay between `apply` and the read-back sweep.  Long enough for the echoes of
// the write commands to drain, so they can't be mistaken for read responses.
export const VERIFY_DELAY_MS = 400;
