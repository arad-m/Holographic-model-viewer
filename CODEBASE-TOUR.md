# How this app works

Someone drops a 3D file. The browser draws it as a hologram and a webcam watches their hands. Each frame, the hands become a few numbers: turn, slide, zoom. Those numbers move the model. Nothing is uploaded.

## Built with

Vite and plain JavaScript. Drawing is Three.js (`three` in `package.json`). Hands and the face are MediaPipe (`@mediapipe/tasks-vision` 0.10.35). Its WASM and `.task` files are in `public/wasm` and `public/models`, so the page needs no CDN. Tests are `node --test`, listed as the `test` script in `package.json`.

## Run

`npm install`, then `npm run dev`, then the localhost URL it prints.

## Read in this order

1. `index.html` — one empty `<div id="app">` and one script. That script, `src/main.js`, is the entry point.
2. `src/main.js` — the only file that knows every part. Jump to `addUpdate(...)`. Each frame: read the hands, apply one gesture, update the tool, move the model, draw, then recording.
3. `src/state.js` — one shared object. Other files change it only through functions here. The gesture is written every frame and does not fire an event.
4. `src/loop.js` — the only `requestAnimationFrame`. Callbacks get `dt` in seconds. A long gap is capped so a hidden tab cannot fling the model.
5. `src/input/webcam.js`, then `src/input/handTracker.js` — the camera, then 21 points per hand. X is flipped once here (`x = 1 - x`). `src/input/handAcquire.js` decides when a second, slower detector looks for the other hand.
6. `src/input/gestures.js` — pinch, two-pinch zoom, fist pan, open-palm reset. A pinch only reports how far the hand moved. It does not pick an axis. The rules are `src/input/gestures.test.js`.
7. `src/render/orientation.js`, then `src/render/modelLoader.js`, `src/render/hologramMaterial.js`, and `src/render/scene.js` — a drag is a free tumble, stored as a quaternion, so the model can face any way. Letting go fades that spin out. The loader takes `.glb`, `.gltf`, `.obj`, or `.stl`. Only `scene.js` draws.
8. `src/tools/modeState.js`, then `src/tools/toolController.js` — Orbit, Slice, Explode, Inspect. A gesture cannot switch modes. Keys 1–4 do.
9. `src/settings/schema.js` — every slider and checkbox, and the defaults saved in this browser.

## Skip

`public/wasm/*.js` is MediaPipe's runtime, not this app. `node_modules` and `dist` are generated.

## Easy to miss

The camera starts only on `localhost` or HTTPS. Mouse and touch do the same jobs as the hands, including the fade after you let go: `src/input/mouseControls.js` and `src/input/touchGestures.js`. Saved models are IndexedDB in `src/storage/db.js`, this browser only.
