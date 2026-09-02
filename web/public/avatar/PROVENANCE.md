# Avatar model provenance

## `facecap.glb`

- **Source:** the three.js `webgl_morphtargets_face` example
  (<https://threejs.org/examples/models/gltf/facecap.glb>).
- **Model credit:** Face Cap — <https://www.bannaflak.com/face-cap>, as credited
  on the three.js example page.
- **Format:** glTF 2.0, `EXT_meshopt_compression` + `KHR_texture_basisu`
  (1024² KTX2 texture), 332 KB.
- **Morph targets:** the full 52-shape ARKit set, which is why it is here.

### This is a development stand-in, not the production avatar

The whole animation pipeline was built and tuned against this model because it
carries a complete, correctly-named ARKit blendshape set. It is a neutral face
scan: bald, no shoulders, flat scan texture. It is right for development and
wrong for a lobby.

**Before shipping to a real waiting room, replace it** and confirm the licence
terms of whatever replaces it are compatible with commercial display. Swapping is
a file drop — see the "Swapping the avatar" section of `KIOSK_SETUP.md`. Any GLB
with ARKit-named morph targets works, and the kiosk logs which channels it found
and which are missing so a partial model fails loudly.

## `../basis/`

`basis_transcoder.js` and `basis_transcoder.wasm`, copied verbatim from
`node_modules/three/examples/jsm/libs/basis/` (three.js r170). They are the
Binomial LLC Basis Universal transcoder, Apache-2.0, redistributed with three.js.

They are committed rather than loaded from a CDN on purpose: a kiosk on a
locked-down clinic network must not need the public internet to render its own
face. Re-copy them from `node_modules` when three.js is upgraded.
