# Vendored files of the swarm view

Committed so the page never leaves `serve.py`'s origin (no CDN, no keys). Each file is copied
unchanged from the npm tarball named in its section; update by downloading the new tarball, copying
the same paths and replacing the version, URL and hashes here.

## three.js 0.183.0 (MIT, `three/LICENSE`)

Tarball: https://registry.npmjs.org/three/-/three-0.183.0.tgz
(sha256 `f9f796410f852c5df3c0727cd9928e6d2aa933b2ac2ce23aa04693ee838ff758`). 0.183 is the newest
release that still ships `build/*.min.js`. `three.module.min.js` imports `./three.core.min.js`;
`three/addons/` is the tarball's `examples/jsm/`.

| File | From | sha256 |
|---|---|---|
| `three/three.module.min.js` | `build/three.module.min.js` | `e3ec4d5d223c0119f754150a3d9deef16139074ea17b073e93bbce315ad16eda` |
| `three/three.core.min.js` | `build/three.core.min.js` | `c5f69a04c70de8c95152040c286a3c8a0489603b019dfd61b34c451e3371c4fd` |
| `three/LICENSE` | `LICENSE` | `8b378ebe60e2fe500158cb0ac71cb5e8b7d92953c2abcc63a0eb90499653b5bc` |
| `three/addons/controls/MapControls.js` | `examples/jsm/controls/MapControls.js` | `5a686152c498914389d1503b60121f484d06f15cb4f7405c15fb6b8ddcc1bdb6` |
| `three/addons/controls/OrbitControls.js` | `examples/jsm/controls/OrbitControls.js` | `09673b997864b8091943d2673637c0f31f7cf67daeddd0902fce9bf098a8d093` |
| `three/addons/utils/BufferGeometryUtils.js` | `examples/jsm/utils/BufferGeometryUtils.js` | `fda7e946b8e0b5ab39b779206589e7a1079a22eb24efb89d7223e03fdfb1f751` |

## htm 3.1.1 with Preact 10 (htm: Apache-2.0, Preact: MIT)

Tarball: https://registry.npmjs.org/htm/-/htm-3.1.1.tgz
(sha256 `2425b9bee11409177bcabc7f32e319926fc6690c1701c0b257c88bdff2d5ba90`). The standalone module
bundles Preact 10 and htm in one file: `import { html, render, useState } from "preact-htm"`.

| File | From | sha256 |
|---|---|---|
| `preact-htm/standalone.module.js` | `preact/standalone.module.js` | `72284e8e9079c87817145df1110f74e8a2aa040b2fc384922e18dfcb46fc1fd7` |
| `preact-htm/LICENSE-htm` | `LICENSE` | `740725f7252e750af735d0028cc534970772f513331e9f68150fede8fb3ce00f` |
| `preact-htm/LICENSE-preact` | `LICENSE` of https://registry.npmjs.org/preact/-/preact-10.29.8.tgz | `1fe6958409c8c257a70c587a18b6f7f412b179b456630790d30b2ec9a8e4b7d4` |

## Fonts (SIL OFL 1.1), latin subset, woff2

Inter, variable weight (one file for 100–900):
https://registry.npmjs.org/@fontsource-variable/inter/-/inter-5.3.0.tgz
IBM Plex Mono 400 and 500:
https://registry.npmjs.org/@fontsource/ibm-plex-mono/-/ibm-plex-mono-5.3.0.tgz

| File | From | sha256 |
|---|---|---|
| `fonts/inter-latin-wght-normal.woff2` | `@fontsource-variable/inter` 5.3.0 `files/` | `3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62` |
| `fonts/LICENSE-inter` | `@fontsource-variable/inter` 5.3.0 `LICENSE` | `3b0a5fca3d17942cde889069889dedbbbd075e9b599968c82a95f4d944e9b345` |
| `fonts/ibm-plex-mono-latin-400-normal.woff2` | `@fontsource/ibm-plex-mono` 5.3.0 `files/` | `08949f728dc52d528e69b1667d15c89a5686a4ee9a296ff90983985f99c380f7` |
| `fonts/ibm-plex-mono-latin-500-normal.woff2` | `@fontsource/ibm-plex-mono` 5.3.0 `files/` | `01d285447409c8a588692162439a038b8cbd7871309ee20267b0d2d91c6e8e22` |
| `fonts/LICENSE-ibm-plex-mono` | `@fontsource/ibm-plex-mono` 5.3.0 `LICENSE` | `23b0a9d0c6d3f140a0b77e483c5cfa6bba574325ef5cb189ed9f2fec4884533f` |
