import React from "react";
import { Environment, Lightformer, ContactShadows } from "@react-three/drei";
import { K } from "../kioskTheme.js";

// Lighting rig and image-based light.
//
// Three points, and the colours are the brand rather than generic studio
// white: a warm paper key, a teal bounce fill, and a teal rim that separates
// the head from the paper backdrop. That rim is the same colour relationship
// as the teal-tinted shadows used everywhere in the existing app, which is
// what makes a 3D head sit inside this design language instead of on top of it.
//
// The environment is built from Lightformers rather than `preset="studio"`.
// drei's presets fetch an HDRI from a CDN, and a kiosk must not need the
// public internet to look right. Rendering it once (`frames={1}`) costs a
// fraction of a millisecond at mount and nothing at all thereafter, while
// still giving the eye specular and skin sheen that separate "a 3D model"
// from "a person".
const qp = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
const lit = (name, dflt) => Number(qp.get(name)) || dflt;

export default function Stage({ quality = 1 }) {
  return (
    <>
      <hemisphereLight args={[K.paper, K.line, lit("amb", 0.50)]} />

      <directionalLight
        position={[1.6, 2.1, 2.4]}
        intensity={lit("key", 1.50)}
        color={K.keyLight}
        castShadow={false}
      />
      <directionalLight position={[-2.0, 1.1, 1.4]} intensity={lit("fill", 0.40)} color={K.fillLight} />
      <directionalLight position={[-0.8, 1.9, -2.2]} intensity={lit("rim", 0.75)} color={K.rimLight} />

      {quality > 0.9 && (
        <Environment resolution={64} frames={1}>
          <Lightformer
            form="rect"
            intensity={lit("env", 3.5)}
            color={K.keyLight}
            position={[0, 2.4, 2.2]}
            scale={[5, 3, 1]}
            target={[0, 0.1, 0]}
          />
          <Lightformer
            form="rect"
            intensity={1.05}
            color={K.rimLight}
            position={[-2.8, 1.6, -1.8]}
            scale={[4, 4, 1]}
            target={[0, 0.1, 0]}
          />
          <Lightformer
            form="ring"
            intensity={0.6}
            color={K.fillLight}
            position={[2.4, 0.6, 1.6]}
            scale={[3, 3, 1]}
            target={[0, 0.1, 0]}
          />
        </Environment>
      )}

      {/* Baked once at mount: zero per-frame cost, and tinted tealDeep to match
          every box-shadow in the rest of the app.

          The Y position matters: the model's bounding box runs from about
          y = -1.5 to y = +1.8, so a shadow catcher at -0.62 sits INSIDE the
          head and renders as a hairline slicing across the jaw. It has to
          clear the bottom of the geometry. */}
      <ContactShadows
        frames={1}
        position={[0, -1.85, 0]}
        scale={5.5}
        blur={2.6}
        opacity={0.26}
        far={1.4}
        resolution={512}
        color={K.shadowCol}
      />
    </>
  );
}
