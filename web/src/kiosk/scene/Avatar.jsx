import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { createTargetBuffer, FACE_CHANNELS } from "../animators/TargetBuffer.js";

// The avatar model.
//
// SWAPPING THIS IS A FILE DROP. Any GLB whose meshes carry ARKit-named morph
// targets works: put it in web/public/avatar/ and point VITE_AVATAR_MODEL (or
// ?model= in debug) at it. On load the kiosk logs exactly which of the
// channels in TargetBuffer.FACE_CHANNELS it found and which are missing, so a
// model with a partial morph set fails loudly instead of silently refusing to
// move its mouth.
//
// The committed default is three.js's `facecap.glb`, which carries the full
// 52-shape ARKit set and is what the whole animation pipeline was built and
// tuned against. It is a neutral face scan, not a designed receptionist -
// deliberately a stand-in. It is bald, has no shoulders, and its texture is a
// flat scan, so it is right for development and wrong for a lobby.
const env = (typeof import.meta !== "undefined" && import.meta.env) || {};
const qsModel = new URLSearchParams(typeof location === "undefined" ? "" : location.search).get("model");
export const MODEL_URL = qsModel || env.VITE_AVATAR_MODEL || "/avatar/facecap.glb";

// Scratch objects, allocated once at module scope and mutated in place. Nothing
// inside the frame loop may allocate: a `new THREE.Quaternion()` per frame is
// ~3.5 MB/minute of garbage, and the resulting GC pauses are visible as
// stutter on exactly the hardware a kiosk runs on.
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/**
 * Find a morph target by name, tolerating the naming conventions in the wild.
 *
 * ARKit blendshapes ship under at least two conventions and exporters disagree:
 * three.js's facecap uses `eyeBlink_L`, Apple's own canonical list and most
 * commercial exporters use `eyeBlinkLeft`, and some tools emit `eyeBlink.L` or
 * differ only in case. Matching one convention exactly means a model built with
 * the other loads perfectly, reports zero channels, and sits there motionless.
 * That is a miserable thing to debug, and swapping the avatar is meant to be a
 * file drop, so all the variants are tried here.
 */
function resolveMorph(dict, name) {
  if (dict[name] !== undefined) return dict[name];

  const variants = [
    name.replace(/_L$/, "Left").replace(/_R$/, "Right"),
    name.replace(/_L$/, ".L").replace(/_R$/, ".R"),
    name.replace(/_L$/, "_l").replace(/_R$/, "_r"),
    name.replace(/Left$/, "_L").replace(/Right$/, "_R"),
  ];
  for (const v of variants) if (dict[v] !== undefined) return dict[v];

  // Last resort: case-insensitive, ignoring separators.
  const norm = (s) => s.toLowerCase().replace(/[._\s-]/g, "");
  const want = norm(name);
  for (const key in dict) if (norm(key) === want) return dict[key];

  return undefined;
}

/**
 * Configure the loader for this model with everything served locally.
 *
 * useDraco is explicitly FALSE. drei's default points DRACOLoader at a Google
 * CDN (gstatic.com), and a lobby kiosk must not need the public internet to
 * render its own face. This model uses meshopt (decoder bundled in
 * three-stdlib) and KTX2 (transcoder copied into /basis/), so nothing here
 * touches the network at runtime.
 */
function makeExtendLoader(gl) {
  return (loader) => {
    const ktx2 = new KTX2Loader().setTranscoderPath("/basis/").detectSupport(gl);
    loader.setKTX2Loader(ktx2);
  };
}

export default function Avatar({ signals, animators, audio, onReady, quality = 1 }) {
  const gl = useThree((s) => s.gl);
  const extendLoader = useMemo(() => makeExtendLoader(gl), [gl]);
  const { scene } = useGLTF(MODEL_URL, false, true, extendLoader);

  const root = useRef();
  const buf = useMemo(() => createTargetBuffer(), []);

  // Resolve every animation channel to a concrete target once, at load. After
  // this there are no string lookups, no traversals and no name matching in
  // the frame loop - just indexed float writes.
  const rig = useMemo(() => {
    const morphTargets = [];   // { influences, map: Int32Array over FACE_CHANNELS }
    scene.traverse((o) => {
      if (!o.morphTargetInfluences || !o.morphTargetDictionary) return;
      const map = new Int32Array(FACE_CHANNELS.length).fill(-1);
      let hits = 0;
      FACE_CHANNELS.forEach((name, i) => {
        const mi = resolveMorph(o.morphTargetDictionary, name);
        if (mi !== undefined) { map[i] = mi; hits++; }
      });
      if (hits) morphTargets.push({ influences: o.morphTargetInfluences, map });
      o.frustumCulled = false;   // a morphing mesh should not recompute bounds
    });

    const byName = (n) => scene.getObjectByName(n) || null;
    const headGrp = byName("grp_transform") || scene;
    const eyeL = byName("grp_eyeLeft");
    const eyeR = byName("grp_eyeRight");

    return {
      morphTargets,
      headGrp,
      headBase: headGrp.quaternion.clone(),
      eyeL, eyeR,
      eyeLBase: eyeL ? eyeL.quaternion.clone() : null,
      eyeRBase: eyeR ? eyeR.quaternion.clone() : null,
      channelCount: morphTargets.reduce((a, m) => a + m.map.filter((x) => x >= 0).length, 0),
    };
  }, [scene]);

  useEffect(() => {
    // Report what the model actually gave us. A silently missing morph set is
    // the failure mode that wastes days: the face loads, looks fine at rest,
    // and simply never moves its mouth.
    const found = FACE_CHANNELS.filter((name, i) => rig.morphTargets.some((m) => m.map[i] >= 0));
    const missing = FACE_CHANNELS.filter((n) => !found.includes(n));
    if (missing.length) console.warn("[kiosk] avatar is missing morph channels:", missing);
    onReady?.({ found: found.length, missing });
  }, [rig, onReady]);

  // Debug handle for the render harness (scripts/shoot.mjs) and for tuning
  // framing on the actual display. Attached only when ?debug=1 is present.
  useEffect(() => {
    if (!new URLSearchParams(location.search).has("debug")) return;
    const materials = [];
    scene.traverse((o) => {
      if (!o.material) return;
      for (const m of [].concat(o.material)) {
        materials.push({
          node: o.name || o.type,
          type: m.type,
          map: m.map ? { class: m.map.constructor.name, w: m.map.image?.width, h: m.map.image?.height, colorSpace: m.map.colorSpace } : null,
          color: m.color?.getHexString?.() ?? null,
          roughness: m.roughness, metalness: m.metalness,
        });
      }
    });
    window.__kiosk = {
      signals, scene, rig, audio,
      dsp: () => audio.debug(),
      materials: () => materials,
      camera: () => {
        const c = gl.__camera;
        return c ? { pos: c.position.toArray(), fov: c.fov } : null;
      },
      fit: () => {
        const box = new THREE.Box3().setFromObject(scene);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        return { size: size.toArray(), center: center.toArray() };
      },
    };
  }, [scene, rig, signals, gl]);

  // Renderer-side settings that want the real device, not a guess.
  useEffect(() => {
    gl.toneMapping = THREE.NeutralToneMapping ?? THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = Number(new URLSearchParams(location.search).get("exposure")) || 2.2;
    gl.outputColorSpace = THREE.SRGBColorSpace;
  }, [gl]);

  // THE single frame loop. Every animated value in the kiosk is written from
  // here, and nothing in this callback calls setState.
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);   // a long frame must not teleport the face
    const now = performance.now();

    signals.t += dt;
    signals.dt = dt;
    signals.frame++;
    signals.quality = quality;

    audio.update(signals, dt, now);
    animators.update(dt, signals, buf);

    // Morph influences.
    const v = buf.values;
    for (let m = 0; m < rig.morphTargets.length; m++) {
      const { influences, map } = rig.morphTargets[m];
      for (let i = 0; i < FACE_CHANNELS.length; i++) {
        const mi = map[i];
        if (mi >= 0) influences[mi] = v[i];
      }
    }

    // Head and neck, composed onto the model's own rest pose.
    _e.set(
      buf.get("head.pitch") + buf.get("neck.pitch") * 0.5,
      buf.get("head.yaw") + buf.get("neck.yaw") * 0.5,
      buf.get("head.roll"),
      "YXZ",
    );
    _q.setFromEuler(_e);
    rig.headGrp.quaternion.copy(rig.headBase).multiply(_q);

    // Eyeballs are separate meshes: the eyeLook morphs move the lids, the
    // globes have to be rotated. Doing only one of the two is uncanny.
    const ax = signals.attention.x, ay = signals.attention.y;
    _e.set(ay * 0.32, -ax * 0.42, 0, "YXZ");
    _q.setFromEuler(_e);
    if (rig.eyeL) rig.eyeL.quaternion.copy(rig.eyeLBase).multiply(_q);
    if (rig.eyeR) rig.eyeR.quaternion.copy(rig.eyeRBase).multiply(_q);

    // Breath, on the whole figure.
    if (root.current) {
      root.current.rotation.x = buf.get("spine.pitch");
      const s = 1 + buf.get("chest.scale");
      root.current.scale.setScalar(s);
    }
  });

  return (
    <group ref={root} position={[0, -0.06, 0]}>
      <primitive object={scene} />
    </group>
  );
}

// Deliberately NOT calling useGLTF.preload() here.
//
// preload() at module scope cannot pass extendLoader, because the KTX2 loader
// needs the live renderer to detect which compressed texture formats the GPU
// supports. Preloading without it primes drei's cache with a load that fails
// as "setKTX2Loader must be called before loading KTX2 textures", and the real
// hook then just re-reads that cached failure - the model never loads at all.
//
// The warm-up is done instead by a <link rel="preload" as="fetch"> injected in
// main.jsx, which fills the HTTP cache without touching the loader.
