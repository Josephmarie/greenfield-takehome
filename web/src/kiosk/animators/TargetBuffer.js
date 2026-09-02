// A fixed set of animation channels with additive and exclusive writes.
//
// Every animator owns one group of channels and writes only through this
// buffer, which is what lets each of them be tested in isolation: feed one
// animator a synthetic signal bus, run it for N simulated frames, and read the
// buffer. No WebGL, no React, no model.
//
// Backed by a Float32Array with a name -> index map computed once, so a frame
// costs a handful of float writes and zero string lookups or allocations.

export const FACE_CHANNELS = [
  // mouth (written by the viseme animator, exclusively)
  "jawOpen", "mouthFunnel", "mouthPucker", "mouthClose",
  "mouthStretch_L", "mouthStretch_R", "mouthUpperUp_L", "mouthUpperUp_R",
  "mouthLowerDown_L", "mouthLowerDown_R", "mouthPress_L", "mouthPress_R",
  "mouthRollLower", "mouthShrugUpper",
  // expression (additive)
  "mouthSmile_L", "mouthSmile_R", "mouthFrown_L", "mouthFrown_R",
  "mouthDimple_L", "mouthDimple_R",
  "browInnerUp", "browOuterUp_L", "browOuterUp_R", "browDown_L", "browDown_R",
  "cheekSquint_L", "cheekSquint_R", "noseSneer_L", "noseSneer_R",
  // eyes
  "eyeBlink_L", "eyeBlink_R", "eyeSquint_L", "eyeSquint_R", "eyeWide_L", "eyeWide_R",
  "eyeLookUp_L", "eyeLookUp_R", "eyeLookDown_L", "eyeLookDown_R",
  "eyeLookIn_L", "eyeLookIn_R", "eyeLookOut_L", "eyeLookOut_R",
];

// Rig channels, in radians / scale, applied to bones rather than morphs.
export const RIG_CHANNELS = [
  "head.yaw", "head.pitch", "head.roll",
  "neck.yaw", "neck.pitch",
  "spine.pitch", "chest.scale",
];

export const ALL_CHANNELS = [...FACE_CHANNELS, ...RIG_CHANNELS];

export function createTargetBuffer() {
  const index = new Map(ALL_CHANNELS.map((name, i) => [name, i]));
  const values = new Float32Array(ALL_CHANNELS.length);
  const exclusive = new Uint8Array(ALL_CHANNELS.length);

  return {
    index,
    values,
    channels: ALL_CHANNELS,

    begin() {
      values.fill(0);
      exclusive.fill(0);
    },

    /** Additive: expression layers stack. Unknown names are ignored. */
    add(name, v) {
      const i = index.get(name);
      if (i === undefined || exclusive[i]) return;
      values[i] += v;
    },

    /** Exclusive: the viseme layer owns the mouth and nothing may fight it. */
    set(name, v) {
      const i = index.get(name);
      if (i === undefined) return;
      values[i] = v;
      exclusive[i] = 1;
    },

    get(name) {
      const i = index.get(name);
      return i === undefined ? 0 : values[i];
    },

    /** Clamp the morph channels; rig channels are angles and stay unclamped. */
    finish() {
      for (let i = 0; i < FACE_CHANNELS.length; i++) {
        const v = values[i];
        values[i] = v < 0 ? 0 : v > 1 ? 1 : v;
      }
    },
  };
}
