# Holographic Model Viewer

Upload a 3D model, see it rendered as a blue hologram, and control it with the mouse or
your hands. Everything runs in the browser — no server, no uploads, no account.

Built with Vite (vanilla JS), Three.js and MediaPipe Tasks Vision.

**Status: Phase 10 - Final audit.**
The viewer is feature-complete. This phase fixed edge cases (model swap mid-gesture, a camera that dies mid-session, a hidden tab, resize, large or empty models, hands that flicker in and out) without adding controls. The sections below are the current way to run and use it. The phase log further down is the build history.

---

## Requirements

- Node.js 18+ (developed on 22.14)
- A modern browser with WebGL2
- A webcam, for the hand-tracking phases
- `localhost` or HTTPS — `getUserMedia` refuses to run otherwise

## Install and run

```bash
cd "Holographic 3D Image"
npm install
npm run dev
```

Open the printed URL (normally http://localhost:5173). Production build:

```bash
npm run build
npm run preview
```

## Mouse controls

| Input | Action |
| --- | --- |
| Drag left mouse button | Orbit the model |
| Drag right mouse button, or Shift+drag | Pan |
| Mouse wheel | Zoom (clamped 0.35x – 4x) |
| Double-click, or the "Reset view" button | Reset rotation, pan and zoom |
| "Load model" button | Open a file picker |
| Drop a file anywhere on the page | Load it |

The model auto-rotates slowly while idle. Auto-rotation pauses while the pointer is down
and resumes from the current orientation on release.

## Sample models

Ready-made files for testing, in `public/samples/`:

- `knot.glb` — a .glb (toroidal knot), one mesh
- `torus.stl` — a binary .stl (torus), one mesh
- `parts.obj` — three boxes as three separate `o` groups, for Explode and Inspect
- `broken.glb` — deliberately corrupt, to check the error path

A development shortcut loads a model through the exact same pipeline as a user upload.
Repeat the `model` parameter to test swapping:

```
http://localhost:5173/?model=/samples/knot.glb
http://localhost:5173/?model=/samples/knot.glb&model=/samples/torus.stl
http://localhost:5173/?model=/samples/broken.glb
```

## Gestures

Distances are measured against the size of the hand, so moving closer to the camera does not change what counts as a pinch. The preview is mirrored; the landmark math is flipped once so a hand moving right turns the model right.

A pose has to hold for a few frames before it starts, so a flicker does not change modes. Two pinching hands win over one pinching hand, which wins over a fist, which wins over an open palm.

| Pose | What it does |
| --- | --- |
| One hand, thumb and index pinched, then move | Orbit, in any direction, including rolling it over. Let go and it keeps turning, then fades to a stop. In Slice or Explode, the vertical part of that drag moves the cut or the separation instead. |
| Two hands, both pinched, then move apart or together | Zoom. Apart zooms in, together zooms out. The scale is relative to the distance between the hands when the zoom started. |
| Fist, then move | Pan. |
| Open palm, held about one second | Reset rotation, pan and zoom, once. Close the hand and open it again to arm another reset. |

Mouse and touch do the same jobs when the hands are not in charge:

| Input | Action |
| --- | --- |
| Drag with the left button, or one finger | Orbit in any direction (or the slice / explode drag, in those modes). Releasing fades the spin out |
| Drag with the right button, Shift+drag, or two fingers moving together | Pan |
| Mouse wheel, or a two-finger pinch | Zoom, clamped between 0.35× and 4× |
| Double-click, or Reset view | Reset the view |

Putting a second finger down mid-drag starts that gesture from the new finger count, so the model does not jump. Touch stops when you lift; it does not keep spinning.

## Keyboard shortcuts

Ignored while a slider, field, or the settings drawer has focus, and ignored with Ctrl, Alt, or Cmd held.

| Key | Action |
| --- | --- |
| 1 | Orbit |
| 2 | Slice |
| 3 | Explode |
| 4 | Inspect |
| Shift+1 … Shift+6 | Hologram preset: Cyan, Orange, Green, Iron Man, Wireframe, Points |
| S | Open or close Settings |
| Escape | Close Settings |

## Settings

Open Settings from the toolbar or press S. Values are saved in this browser (`localStorage`) and restored on reload. Reset to defaults clears them.

**Gestures.** Pinch threshold and pinch release (how closed the fingers must be to grab, and how far they must open to let go), fist curl, rotation sensitivity, pan sensitivity, smoothing.

**Hologram.** Intensity, scanline density, flicker, volume.

**Performance.** Quality (Low / Medium / High) sets the pixel ratio, how often hands and the face are detected, and how strong the shader flicker is. Auto quality steps down one level if the frame rate stays under 30 for about five seconds; it does not step back up on its own. FPS counter shows a live rate. Head parallax and Parallax depth lean the camera as you lean; parallax is off until you turn it on. Recalibrate (on the performance readout) sets the current head position as the centre.

**Interface.** Hand skeleton, debug overlay, camera preview, transparent screenshots, record with the camera inset.

## Browser support

- A current Chromium browser is the one this was built against (Chrome or Edge). WebGL2 is required for the hologram.
- The camera needs `getUserMedia`, which only runs on `http://localhost` or `https://`. Opening the built files as `file://` will not start the camera.
- Hand and face tracking use MediaPipe Tasks Vision (WASM served from this app, not a CDN). The first run tries the GPU; if that fails or never returns a face, it falls back to the CPU.
- Recording needs `MediaRecorder` and a supported video codec. If the browser has neither, the Record button says so and the rest of the app still works.
- The model library uses IndexedDB in this browser only. It is not an account and it does not sync.

`npm test` runs the gesture, settings, tool, and storage checks in Node. It does not open a camera.

## Troubleshooting

**The camera never starts.** Use the `npm run dev` URL (`localhost`) or serve the production build over HTTPS. In the address bar, allow the camera for this site and reload. A denied or dismissed prompt stays denied until you change it in the site settings. Another app (or another browser tab) may already be holding the camera.

**Hands are not detected.** Face a window or a lamp so the hand is brighter than the background. Keep the whole hand inside the preview, roughly a forearm's length from the lens. A hand at the edge of a wide camera can sit outside the preview box even when you can see it on the raw feed. The preview uses `contain`, so the full frame is visible and letterboxed.

**Only one hand is found.** While one hand is tracked, a separate full-frame search looks for the second hand about every 700 ms. The hand you are already using keeps the cheap tracker, so that search does not stall the hologram. Hold both hands up for a moment. The status line reads "2 hands" when both are in frame.

**Head parallax does nothing.** Turn it on under Settings → Performance. The readout should say "Face recognized". Lean your head; a small shift of the view is the effect. If it says "No face" or "Looking for a face…", the same lighting and distance notes apply, and only one face is used. Walk out of frame and the view eases back to centre.

**The camera dies mid-session.** Unplugging it, or the OS revoking it, stops hand control and shows a notice. Plug it back in and reload. Mouse and touch keep working.

**A model will not open.** Empty files, files with no mesh, files over 80 MB, and models with more than 2,000,000 vertices are rejected with a message and the previous model stays on screen. `.glb` / `.gltf`, `.stl`, and `.obj` are the formats the loader accepts.

## Known limitations

- One face for parallax. If two people are in frame, MediaPipe's first face is the one that leans the camera.
- The second hand is not instant. A separate search runs about every 700 ms while one hand is tracked, and while both are held that search updates about 15 times a second so the hologram can keep drawing.
- Auto quality only steps down. Pick a higher level yourself, or reset settings, to go back up.
- Touch has no throw. Lift your fingers and the model stops. Hand rotate and mouse orbit still ease out.
- Three-finger touch is treated as a pinch (the average span), not as its own gesture.
- A compressed `.glb` is checked for file size before it is parsed and for vertex count after. A small file that expands into a huge mesh is rejected after that parse, not before.
- The library, settings, and recordings stay on this browser. Clearing site data deletes them.
- Tests do not open a camera, so a lighting or permission problem only shows up in the browser.

---

## Architecture

Fixed from Phase 0. Do not restructure without asking.

| Rule | Where it lives |
| --- | --- |
| One shared `state` object, one source of truth | `src/state.js` |
| Tiny event emitter (`on` / `off` / `emit`) | `src/events.js` |
| Exactly one `requestAnimationFrame` loop, dt in seconds | `src/loop.js` |
| Gesture math is pure (no DOM, no Three.js) | `src/input/gestures.js` |
| The renderer never reads raw landmarks, only `GestureState` | `src/render/*` |
| The webcam x-flip happens once, at the input layer | `src/input/handTracker.js` |
| All pointer/gesture movement goes through `state.transform` | `src/input/mouseControls.js` |
| Transform values become three.js properties in one function | `applyTransform()` in `src/render/scene.js` |

### Directory map

```
index.html               single page, mounts #app
src/main.js              entry point: builds the stage + sensor stack, wires everything, runs the loop
src/state.js             shared state + the only mutators
src/events.js            createEmitter() and the shared `events` bus
src/loop.js              the single rAF loop, addUpdate/removeUpdate, start/stop
src/styles.css           tokens, stage, toolbar, empty state, status pill, toasts, drop overlay, sensor HUD
src/render/scene.js      renderer, camera, pedestal, resize, applyTransform()
src/render/hologramMaterial.js   hologram shader, wireframe shell, uniform updates, disposal
src/render/modelLoader.js        glb/gltf/obj/stl parsing, normalize, material swap, disposal
src/input/webcam.js      getUserMedia, <video>, mirrored preview + landmark canvas, errors
src/input/handTracker.js MediaPipe HandLandmarker, mirror-space output, skeleton drawing
src/input/gestures.js    GestureState contract + pure pinch maths + createGestureEngine()
src/input/mouseControls.js       orbit / pan / zoom / reset, writes state.transform
src/tools/modeState.js   the four tool modes, their shortcuts and the vertical-drag routing
src/tools/slice.js       pure slice maths: plane from axis+position, triangle/plane sections
src/tools/explode.js     pure explode maths: direction from centre, offset per amount
src/tools/toolController.js      the live side of the tools: plane, seam, parts, inspector
src/render/presets.js    the six hologram presets + eased preset transitions
src/render/pointCloud.js point-cloud look: one additive Points per mesh, shared gradient texture
src/render/sliceSection.js       bakes model triangles, draws the glowing cut line, honours the model transform
src/render/explodeModel.js       caches original positions + directions, applies/restores the explosion exactly
src/render/inspect.js    raycasts from a normalized point, highlights the hit mesh, names it
src/settings/schema.js   every setting: key, label, group, type, range, step, default, validator
src/storage/settings.js  validated localStorage persistence (sanitise, load, save, clear)
src/settings/persistSettings.js  the one subscription that saves on every settings change
src/ui/toolbar.js        Load model, Reset view, Hands/Sound/Debug/Settings toggles, drag-and-drop
src/ui/presetBar.js      the six preset buttons (swatch, name, shortcut)
src/ui/settingsPanel.js  the collapsible drawer, generated from the schema
src/ui/feedback.js       empty state, status pill, toasts, hand HUD (status + debug)
src/ui/library.js        the collapsible saved-model panel (cards, thumbnails, delete)
src/storage/db.js        IndexedDB: model metadata + blobs, degrading instead of throwing
src/library/records.js   pure record rules: sanitise, sort, format, duplicate detection
src/library/thumbnail.js centre-cropped square JPEG of the live canvas
src/capture/frames.js    pure capture rules: mime choice, filenames, duration, error text
src/capture/screenshot.js        PNG through a WebGLRenderTarget (UI never in frame)
src/capture/recorder.js  MediaRecorder on canvas.captureStream, optional webcam composite
public/samples/          knot.glb, torus.stl, parts.obj, broken.glb
public/wasm/             MediaPipe vision runtime (copied from the pinned package)
public/models/           hand_landmarker.task (7.8 MB)
```

### State shape

```js
state = {
  model:     { object: null, baseScale: 1 },   // Object3D + loader-normalized scale
  transform: { rotX: 0, rotY: 0, panX: 0, panY: 0, scale: 1 },
  mode:      'mouse',                          // 'mouse' | 'gesture'
  settings:  { ...everything in settings/schema.js,
               fistThreshold, hologramIntensity, scanDensity, flicker,
               hologramPreset, soundEnabled, rotateSensitivity, zoomSensitivity,
               smoothingRate },
  tool:      { mode, sliceAxis, slicePosition, explode, inspectLabel },
                                               // view state, kept apart from preferences
  gesture:   GestureState,                     // never null, written every frame
  status:    { code: 'idle', message: '' },
}
```

Mutators (`setModel`, `setTransform`, `resetTransform`, `addTransformDelta`, `setMode`,
`patchSettings`, `resetSettings`, `setToolMode`, `patchTool`, `resetTool`, `setStatus`) emit
`'state:changed'` with `{ keys }`.
Two deliberate exceptions:

- `setTransform(..., { silent: true })` skips the event for continuous writers (pointer
  drag, wheel zoom, and later the gesture stream) so the bus is never flooded.
- `setGesture()` never emits — it updates 30–60×/s and is read straight from the loop.

### Hologram shader

`hologramMaterial.js` builds a `ShaderMaterial` with additive blending, `depthWrite: false`
and `DoubleSide`. Layers: fresnel rim, world-space scrolling scanlines, gentle flicker with
a rare full-surface dropout, occasional per-slice glitch displacement, and an optional
faint wireframe shell (a child mesh sharing the source geometry).

Uniforms, all drivable later: `uColor`, `uRimPower`, `uRimIntensity`, `uScanDensity`,
`uScanSpeed`, `uFlicker`, `uGlitch`, `uOpacity`, `uFill`, `uTime`.

### Model pipeline

`loadModel(file)` → parse by extension → collect meshes (error if none) → replace every
material with the hologram material + wireframe shell → center on the origin inside nested
groups → report `baseScale` so the largest dimension becomes `TARGET_SIZE` (1.6 units).

`main.js` adds the new object, calls `setModel`, resets the transform, then disposes the
previous model (geometries, materials, textures, detach). A failed load disposes anything
it had built and leaves the current model in place.

### Frame-rate independence

`loop.js` hands every callback `dt` in seconds, clamped to 1/15 s. Auto-rotation uses `dt`;
smoothing in later phases must use `1 - exp(-rate * dt)`, never a fixed per-frame factor.

---

## Manual test checklist (Phase 1)

1. `npm install && npm run dev` starts with no console warnings.
2. Page loads: dark stage, glowing pedestal ring, toolbar, centred "Drop a 3D model" card.
3. Drop `public/samples/knot.glb` (or "Load model"): blue hologram with rim glow and moving
   scanlines, the card disappears, the status pill shows the filename.
4. Drop `public/samples/torus.stl`: the first model is replaced, status pill updates.
5. Left-drag spins; auto-rotation stops while dragging and resumes after release.
6. Wheel zooms and stops at ~0.35x and ~4x.
7. Right-drag pans; the model stays inside the visible area.
8. Double-click resets rotation, pan and zoom.
9. Drop `public/samples/broken.glb`: red toast + red status pill saying
   `"broken.glb" is not a valid GLB model.`, the previous model stays on screen.
10. Drop a `.txt`: `.txt files are not supported. Use .glb, .gltf, .obj, .stl.`
11. Swap between the two samples a few times: no ghost meshes, geometry count stays flat.
12. Narrow the window to ~400 px: nothing overflows horizontally.

## Known limitations (Phase 1)

- `.gltf` files that reference external `.bin`/texture files cannot resolve them from a
  single dropped file; the error message tells the user to export a `.glb` instead.
- No Draco/meshopt compression support, and no texture handling: every material is
  replaced by the hologram shader, so source textures are ignored (and disposed).
- The wireframe overlay duplicates draw calls per mesh; very dense meshes look noisier.
- Auto-rotation is always on; there is no settings toggle yet.
---

## Phase 2 — webcam, hand tracking, pinch detection

The app opens the camera, tracks up to two hands with MediaPipe, and reports a pinch per
hand. **The model still does not react to hands** — that arrives with the gesture-control
phase. Mouse controls keep working exactly as before.

### Requirements

- `localhost` or HTTPS (`getUserMedia` refuses anything else)
- A webcam, and permission when the browser asks
- The WASM runtime and the 7.8 MB model are self-hosted in `public/wasm` and
  `public/models/hand_landmarker.task`, so nothing is fetched from a CDN at runtime

### What you get

- Mirrored camera preview in the bottom-right corner, hand skeleton drawn on top
- A hand status line above the preview: `Camera off` / `Starting camera…` / `No hand` /
  `Hand detected` / `Pinching (1 hand)` / `Pinching (2 hands)`
- A debug panel under it showing, live: render FPS, inference time, the active delegate
  (`GPU` or `CPU`), and per hand its id, normalized pinch distance and `PINCH`/`open`
- A **Debug** button in the toolbar that hides or shows that panel

If the camera fails — blocked, missing, busy, or the permission prompt is ignored for 20
seconds — the preview turns into a readable notice, the status line says `Camera off`, and
the rest of the app (orbiting, zooming, loading models) keeps working.
### How pinch is decided

```
pinchDistance = distance(thumb tip 4, index tip 8) / distance(wrist 0, middle MCP 9)
```

Dividing by hand size makes it work at any distance from the camera (40–70 cm is the
comfortable band). Hysteresis then decides the state, per hand:

| Transition | Condition |
| --- | --- |
| inactive → active | `pinchDistance <= pinchStartThreshold` (default **0.25**) |
| inactive → inactive | `pinchDistance > pinchStartThreshold` |
| active → inactive | `pinchDistance > pinchReleaseThreshold` (default **0.40**) |
| active → active | anything up to 0.40, so a hand resting between the two numbers cannot flicker |

Both thresholds live in `state.settings` and are passed into the pure hysteresis function
every frame.

### Landmark conventions

- 21 normalized landmarks per hand, mirror space: `x = 1 - x` is applied **once**, in
  `handTracker.js`. The preview video is mirrored separately in CSS to match.
- MediaPipe's Left/Right is inverted for us (we feed it the unmirrored frame), so it is
  swapped in the same place.
- Hand ids are stable while a hand stays visible: `Left`, `Right`, or `Right#1` when two
  hands report the same handedness.

### Files touched by Phase 2

| File | Responsibility |
| --- | --- |
| `src/input/webcam.js` | `getUserMedia`, `<video>`, preview + landmark canvas, readiness, error mapping, prompt watchdog |
| `src/input/handTracker.js` | `HandLandmarker` (2 hands, VIDEO mode, GPU→CPU fallback), strictly increasing timestamps, single x-flip, skeleton drawing |
| `src/input/gestures.js` | pure pinch maths, hysteresis, pinch point, status label, `createGestureEngine()` |
| `src/ui/feedback.js` | `createHandHud()`: hand status + debug panel |
| `src/ui/toolbar.js` | Debug toggle |
| `src/state.js` | `pinchStartThreshold`, `pinchReleaseThreshold`, `showDebugOverlay` |
| `src/main.js` | camera bootstrap, one detection per frame, `state.gesture`, FPS |

Per frame `main.js` writes into `state.gesture`: `hands[].pinch`, `hands[].pinchRatio` and
`hands[].id`. `fist`, `openPalm` and `indexPoint` stay false, `action` stays `'none'`, and
`delta` stays zero.
### Manual test checklist (Phase 2)

1. Load with the camera allowed: preview shows you mirrored, status `No hand`, then
   `Hand detected` when a hand enters the frame.
2. Touch thumb and index together: `Pinching (1 hand)`, the debug row turns green with
   `PINCH`, and the number drops below 0.25.
3. Move the hand between 40 and 70 cm: the number stays in the same range (hand-size
   normalization) and the status does not flicker.
4. Hold the pinch half-open so the number sits around 0.30–0.35: the state stays latched.
5. Open the pinch: `Hand detected` comes back only after the number passes 0.40.
6. Both hands pinching: `Pinching (2 hands)` with two debug rows.
7. Both hands visible, one pinching: `Pinching (1 hand)`.
8. Press **Debug**: the numbers panel hides; press again to restore it.
9. Block the camera and reload: red notice in the preview, status `Camera off`, drag/zoom
   still work, no uncaught console errors.
10. With the tracker live the model still auto-rotates and ignores your hands.

### Known limitations (Phase 2)

- **No gesture control yet.** Pinch is detected and displayed; it does not move the model.
- No fist, palm or pointing detection (reported false), no smoothing filter yet.
- No retry button: after a camera failure you must reload.
- The live hand path could not be exercised in this environment (no camera). Pinch maths,
  hysteresis, ids and the whole camera-failure path are covered by automated checks (40/40)
  plus a browser run with the camera denied; the live path follows the published MediaPipe
  API and needs one human confirmation.
- The debug panel is throttled to 10 Hz on purpose; state updates every frame.
- The CPU fallback is slower (expect a visible FPS drop on weak machines).
---

## Phase 3 — landmark smoothing and pinch-drag rotation

A one-hand pinch now rotates the model, exactly like a mouse drag: it moves only while
pinched, stops on release, and left/right/up/down match the hand. Zoom and pan are still
mouse-only.

### Smoothing (One Euro, before any gesture logic)

Every landmark of every hand is filtered **before** pinch detection and drag maths, so the
hysteresis and the rotation both work on the same steady numbers.

**Why One Euro rather than an EMA:** an EMA strong enough to kill landmark jitter (without
it, the model trembles while you hold still) adds visible lag during a fast drag. One Euro
raises its cutoff as the signal speeds up: heavy smoothing at rest, almost none while
moving. That is exactly the trade-off this gesture needs, and it is what keeps the pinch
point from trailing the hand.

- Setting: `state.settings.landmarkSmoothing`, **0..1** (default `0.5`).
  `0` = raw landmarks, `1` = steadiest (maps to the lowest cutoff, 0.7 Hz; `0.5` → 3.35 Hz).
- `beta = 2` (how fast the filter opens up while moving) and `dCutoff = 1` are constants in
  `input/gestures.js`.
- Measured on the code: at the strongest setting the filter removes ~94% of a ±2 mm
  hand tremor, and still tracks a 6 units/s drag with ~9% lag.

### Dropout tolerance (~150 ms)

If a pinching hand disappears for less than `DROPOUT_GRACE_MS` (150 ms), its last pose is
carried forward and the pinch stays latched — that is what stops a fast move, motion blur or
a brief occlusion from dropping the grab. Past 150 ms the pinch releases normally. While the
hand is carried the model does not move at all.

When real tracking returns, the drag **re-anchors**: the first fresh sample only sets the new
origin, so the model cannot jump by however far the hand travelled during the gap.

### Pinch-drag rotation

While **exactly one** hand is pinching:

```
delta.rotY = (pinchPoint.x - lastPinchPoint.x) * ROTATE_GAIN * sensitivity
delta.rotX = (pinchPoint.y - lastPinchPoint.y) * ROTATE_GAIN * sensitivity
```

- `ROTATE_GAIN = 5` rad per full frame width — the same ballpark as the mouse's
  `0.0062 rad/px` over a ~900 px stage.
- Hand right → `rotY` increases → the model's right side turns toward the viewer, matching a
  mouse drag right. Hand down → `rotX` increases, matching a mouse drag down.
- Setting: `state.settings.gestureRotateSensitivity` (0.1..4, default `1`).
- Two hands pinching = no rotation at all (that slot is reserved for zoom in a later phase).
- The first frame of a grab is only an anchor, so grabbing never snaps the model.
- `rotX` is clamped to ±1.35 rad (the same limit the mouse uses), so the model cannot flip
  over; hitting the limit also cancels the throw.

### Inertia after release

On release the last drag velocity becomes a throw, decayed **frame-rate independently**:

```
delta = velocity * dt;  velocity *= exp(-INERTIA_DAMPING * dt)
```

- `INERTIA_DAMPING = 3.5` 1/s (≈0.29 s time constant), `MAX_INERTIA_VELOCITY = 9` rad/s,
  and it stops below `INERTIA_STOP = 0.12` rad/s.
- Measuring on the code: the same drag-and-release produces 3.35 rad of rotation at 60 Hz
  and 3.39 rad at 144 Hz (1% apart), and a deliberate slow open barely throws at all.

### Auto-rotation hand-off

Idle spin eases to 0 the instant a grab starts, stays off for 1 s after release, then ramps
back in over 0.8 s (`AUTO_ROTATE_RESUME_DELAY_MS`, `AUTO_ROTATE_RAMP_SECONDS` in `main.js`).
Nothing snaps on or off, and a grab never fights the idle spin.

### Where the delta is applied

`GestureState.delta` stays pure data. `main.js` has exactly one function that applies it:

```js
const wantedRotX = state.transform.rotX + delta.rotX;
const clampedRotX = clamp(wantedRotX, -MAX_PITCH, MAX_PITCH);
setTransform({ rotY: state.transform.rotY + delta.rotY, rotX: clampedRotX }, { silent: true });
```

### New settings

| Setting | Range | Default | Effect |
| --- | --- | --- | --- |
| `landmarkSmoothing` | 0..1 | `0.5` | One Euro strength on every landmark, before gesture logic |
| `gestureRotateSensitivity` | 0.1..4 | `1` | Multiplier on pinch-drag rotation |

Both live in `src/state.js` (`DEFAULT_SETTINGS`) and are read per frame in `main.js`, so a
future settings panel only has to call `patchSettings()`.

### Files touched by Phase 3

| File | Change |
| --- | --- |
| `src/input/gestures.js` | One Euro filter (`createOneEuroAxis`, `createHandSmoother`, `smoothLandmarks`), dropout carry, drag state, re-anchoring, inertia, `ROTATE_GAIN` / `DROPOUT_GRACE_MS` / `INERTIA_DAMPING` / `INERTIA_STOP` / `MAX_INERTIA_VELOCITY` |
| `src/state.js` | `landmarkSmoothing`, `gestureRotateSensitivity` |
| `src/main.js` | `applyGestureDelta()` (the only delta applier), `autoRotateFactor()` pause/ramp, `pollHands()` passes smoothing + sensitivity + `nowMs` |

### Manual test checklist (Phase 3)

1. Load a model, allow the camera, show one hand, pinch. The model does **not** move at the
   moment you pinch.
2. With the pinch held, move the hand right: the model turns right, matching a mouse drag
   right. Move left: it turns left. Vertical movement pitches it.
3. Stop moving while pinching: the model stops too (no drift, no tremble).
4. Release the pinch: the model keeps turning briefly and eases to a stop.
5. Grab again immediately: no jump, no snap — the rotation resumes from wherever it was.
6. Drag fast enough that tracking drops for a frame or two: the grab survives, and the model
   does not jump when the hand is found again.
7. Drag up or down until it stops: the model never flips past vertical.
8. With the camera blocked (mouse only) everything behaves exactly as in Phase 1.
9. Idle for a second after releasing: the slow auto-rotation fades back in rather than
   snapping on.
10. Set `landmarkSmoothing` to 0 and to 1 (via `patchSettings` in the console, e.g.
    `import('/src/state.js').then(m => m.patchSettings({ landmarkSmoothing: 1 }))`): at 0 the
    model follows every jitter, at 1 it is very steady but slightly laggy.

### Known limitations (Phase 3)

- **Live-hand tuning was not possible here** (no camera in this environment). The gesture
  maths, the smoothing, the dropout window, the re-anchoring, the inertia and the
  frame-rate independence are covered by 34 automated checks; the feel (gain, damping,
  smoothing default) is set from the mouse's numbers and needs one human pass with a real
  camera.
- Phase 3 shipped rotation only; Phase 4 adds zoom, pan and reset.
- Smoothing has no per-axis tuning; `beta`/`dCutoff` are constants.
- Sensitivity and smoothing are settings but have no UI controls yet.
- The pitch clamp is enforced in `main.js`, not in the pure engine, because it depends on the
  current transform.
- Inertia is not applied while a *mouse* drag is in progress (the pointer has priority).
---

## Phase 4 — zoom, pan, palm reset and the gesture state machine

All four gestures now work, and exactly one of them is active at any moment.

| Gesture | Action | What moves |
| --- | --- | --- |
| Both hands pinching | `zoom` | `scale` |
| One hand pinching | `rotate` | `rotX` / `rotY` |
| Fist | `pan` | `panX` / `panY` |
| Open palm held ~1 s | `reset` | everything eases back to defaults |

### Priority and the stability gate

The engine resolves every frame through one pure function, highest priority first:

```
if (twoHandPinch) return 'zoom';
if (oneHandPinch) return 'rotate';
if (fist)         return 'pan';
if (palm)         return 'palm-hold';
return 'none';
```

- **A gesture must hold for `ACTIVATION_FRAMES` (3) consecutive frames** before it
  activates — about 50 ms at 60 fps. That is what stops a two-frame misclassification from
  grabbing the model.
- **Deactivation is immediate**: the moment an action's own signal disappears it stops, so
  releasing a pinch feels instant rather than sticky.
- **Only one action is ever active**, exposed as `GestureState.action`, and only that action
  writes a delta. Rotate owns `rotX`/`rotY`, pan owns `panX`/`panY`, zoom owns `scale` — they
  cannot fight over the same value.
- **When two hands disagree**, the higher priority wins: one hand pinching plus one fist is a
  rotate, never a pan.
- **Every action anchors on entry** (and re-anchors whenever its input identity changes), so
  switching gestures can never jump the model.

### A pinch can never trigger a fist or a palm

Classification is deliberately exclusive:

```js
const fist = !pinching && nextFistActive(wasFist, extensions);
const palm = !pinching && !fist && nextPalmActive(wasPalm, extensions);
```

A pinching hand is reported with `fist: false` and `openPalm: false`, and a fist is never
reported as a palm. The geometry backs that up: a fist needs **all four** fingertips close to
the palm (a pinching index stays far away), and a palm needs **all four** extended.

### Two-hand zoom

```
zoomFactor = distance(now) / distance(when the zoom started)
```

- Hands apart -> factor > 1 -> zoom in. Hands together -> factor < 1 -> zoom out.
- The anchor is captured on activation, and `main.js` multiplies it by the scale that was
  already in place: `scale = clamp(zoomStartScale * zoomFactor, 0.35, 4)`. The first frame is
  exactly 1, so entering two-hand mode never snaps the size.
- If the pair of hands changes (one drops, another appears) the anchor is retaken, so the model
  cannot jump when tracking swaps hands.
- The factor is clamped to 0.2..5 before the scale clamp, so a tracker glitch cannot produce a
  divide-by-almost-zero spike.

### Fist-drag pan

Fingertips are measured against the palm centre, normalized by hand size:

```
extension[i] = distance(fingertip[i], palmCentre) / distance(wrist, middleMCP)
fist  when max(extension) <= 0.90   (stays until max > 1.02)
palm  when min(extension) >= 1.20   (stays until min < 1.08)
```

The gap between enter and exit is the hysteresis; without it a fist flaps on and off between
frames. Pan uses the palm centre as its handle, with the mouse's signs (`+dx`, `-dy`) and the
same ±2.2 clamp, so pan and zoom compose cleanly: zoom writes `scale`, pan writes
`panX/panY`, and neither touches the other.

### Open-palm reset

Hold an open palm for `PALM_HOLD_MS` (1000 ms) and the view eases back to defaults:

- The hold timer starts when `palm-hold` activates and is cleared the instant the palm closes:
  **an interrupted hold never resets** (there is a test for exactly that).
- On firing, the engine emits `resetRequested: true` for exactly one frame and sets
  `action: 'reset'` for that frame. `main.js` starts the animation.
- The animation is frame-rate independent (`alpha = 1 - exp(-9 * dt)`) on `rotX`, `rotY`,
  `panX`, `panY` and `scale`, then snaps to exact defaults. Grabbing anything cancels it.
- The reset re-arms only after the palm has been dropped, so holding your hand open resets
  **once**, not once per second.

### Status indicator

`describeActionStatus()` maps the active action to `Grabbing` / `Zooming` / `Panning` /
`Resetting`, and the HUD prefers it over the plain hand labels. While the reset animation is
running the label stays `Resetting`.

### Constants (all in `src/input/gestures.js`)

| Constant | Value | Meaning |
| --- | --- | --- |
| `ACTIVATION_FRAMES` | 3 | stable frames before a gesture activates |
| `PALM_HOLD_MS` | 1000 | open-palm hold that triggers the reset |
| `FIST_THRESHOLDS` | 0.90 / 1.02 | enter / exit for the fist |
| `PALM_THRESHOLDS` | 1.20 / 1.08 | enter / exit for the open palm |
| `PAN_GAIN` | 3 | world units of pan per normalized unit of palm travel |
| `ROTATE_GAIN` | 5 | radians per normalized unit of pinch travel |
| `MIN_SCALE` / `MAX_SCALE` | 0.35 / 4 | zoom limits, same as the mouse |
| `MAX_PAN` | 2.2 | pan limit, same as the mouse |
| `DROPOUT_GRACE_MS` | 150 | how long a pinching hand may vanish |

### Tests

`npm test` runs `src/input/gestures.test.js` with the Node test runner — 23 checks, no DOM, no
Three.js, no camera:

- pinch hysteresis (start, release, custom thresholds)
- fist classification (all four curled, one extended, hysteresis band)
- open-palm classification (all four extended, one curled, hysteresis band)
- finger-extension geometry on a synthetic hand
- priority resolution for every combination of signals
- action status labels
- the 3-frame stability gate, and that the activation frame only anchors
- a pinch never reports `fist` or `openPalm`
- rotate sign (hand right -> +rotY), fist pan signs (right -> +panX, down -> -panY)
- two-hand zoom factor (1 at entry, 2 when distance doubles, 0.5 when halved)
- zoom re-anchoring after the pair of hands changes
- higher priority wins when hands disagree
- one reset per held palm, re-armed only after the palm is dropped
- an interrupted palm hold cancels the reset
- switching from rotate to pan without a jump

### Manual test checklist (Phase 4)

1. Pinch with one hand and move: `Grabbing`, the model turns. Release: it stops (with a short
   throw), and idle auto-rotation eases back in about a second later.
2. Make a fist and move: `Panning`, the model slides with the hand, up/down/left/right all
   correct. The size does not change and it does not rotate.
3. Pinch with both hands and move them apart: `Zooming`, the model grows. Bring them
   together: it shrinks. It stops at the limits and does not jump when you enter or leave.
4. While zoomed and panned, pinch one hand: `Grabbing` only — the size and position stay put.
5. Hold an open palm for about a second: `Resetting`, and rotation, zoom and pan all ease back
   to the default view.
6. Start an open palm and close it after half a second: nothing happens.
7. Keep your palm open: it resets once, not again and again.
8. Pinch, then open the pinched hand into a fist in one motion: no pan is triggered while the
   pinch is still active.
9. Show one pinching hand and one fist: the model rotates, it does not pan.
10. Switch rapidly between the four gestures: the model never jumps and only one label shows
    at a time.

### Known limitations (Phase 4)

- **The live-hand path could not be exercised here** (no camera in this environment). All of
  the classification, priority, anchoring, clamps and the reset logic are covered by the 23
  automated checks, and the page was loaded with the camera denied; the thresholds still need
  one human pass with a real camera.
- Fist and palm thresholds are constants, not settings yet, and there is no UI for them.
- Pan has no inertia (rotation does).
- Zoom is relative to the two pinch points only: moving both hands sideways in the same
  distance does not pan during a zoom.
- A wheel zoom during a two-hand zoom is overridden by the gesture (the gesture owns `scale`
  while it is active).
- Only one reset can be pending at a time; the reset is not undoable.
---

## Phase 5 — gesture feedback, in-scene skeleton and synthesized sound

Every gesture now shows what it is doing, and the hands themselves are drawn inside the 3D
scene. All of it is driven by `GestureState` and a single cue rule — no gesture logic was
changed in this phase.

### On-stage feedback (2D overlay)

A transparent canvas sits above the WebGL stage and never takes pointer events:

| Signal | Drawn as |
| --- | --- |
| Pinch (one or two hands) | glowing dot at each pinch point, with a soft outer ring |
| Two-hand zoom | dashed line between both pinch points, end caps, and the live factor (`1.24x`) on a chip at the midpoint |
| Open-palm hold | progress ring around the palm centre, filling over `PALM_HOLD_MS` |
| Fist (pan) | four-arrow crosshair at the palm centre |

Every element fades in and out independently (`1 - exp(-11 * dt)`), so nothing pops when a
gesture starts or a hand leaves. The canvas is resized from `getBoundingClientRect()` on every
frame rather than once at construction, so the first frame after a layout change cannot map
points to the wrong place.

### Hand skeleton (in the 3D scene)

Each hand is drawn in the hologram cyan as a bright core of 21 points, a faint wider halo, and
the 21 MediaPipe bones as additive lines.

- Mapped onto a fixed 4:3 plane at `z = 1.15`, between the model (`z = 0`) and the camera
  (`z = 4.6`), so it floats in front of the model instead of intersecting it.
- **Mirrored correctly**: landmarks arrive in mirror space (the single x-flip already happened
  in `handTracker.js`), so the mapping is a straight `(x - 0.5) * width`, `(0.5 - y) * height`
  with no second flip.
- Each hand id keeps a stable slot (two slots), so two hands never swap meshes mid-track.
- A hand that is lost fades out over ~0.15 s and then releases its slot.
- Toggleable with the **Hands** button, on by default (`settings.showHandSkeleton`).
- Points and bones share ONE `BufferAttribute`. (Worth knowing: `Float32BufferAttribute`
  copies the array it is given, so writing into a separate `Float32Array` leaves the geometry
  collapsed at the origin. That was caught in the browser, not by a unit test.)

### Sound (`src/audio/sound.js`)

Everything is synthesized with Web Audio — no asset files.

| Cue | Sound |
| --- | --- |
| Grab | short bright triangle blip, 520 → 780 Hz, 100 ms |
| Release | softer sine, 420 → 290 Hz, 160 ms |
| Zoom | continuous sawtooth through a lowpass; its pitch follows zoom **speed** (150 → 620 Hz), fading in over 60 ms and out over 120 ms |
| Reset | two rising notes, 523 Hz then 784 Hz |
| Ambient | a quiet two-oscillator drone (55 Hz and 82.5 Hz, slowly detuned) through a 240 Hz lowpass |

- **One cue per event**, guaranteed by a pure rule in `src/audio/cues.js`: cues come from the
  *transition* between the previous and current action, so holding a pinch for 300 frames
  produces exactly one grab and one release (unit tested).
- **The AudioContext is created only inside a real pointerdown/keydown.** No cue may create it,
  so nothing plays — and no autoplay warning is logged — before the user has interacted.
- **Mute** button toggles `settings.soundEnabled` and sets the master gain to 0; the volume
  slider sets `settings.soundVolume` (0..1) and is disabled while muted.

### Toolbar additions

`Hands` (skeleton on/off), `Sound` (mute) and a volume slider next to it. All three reflect
their state with `aria-pressed` and are hidden or simplified on narrow screens (the slider
collapses below 860 px, labels below 460 px).

### New settings

| Setting | Type | Default | Effect |
| --- | --- | --- | --- |
| `showHandSkeleton` | boolean | `true` | draw the in-scene hand wireframe |
| `soundEnabled` | boolean | `true` | audio cues on/off |
| `soundVolume` | number | `0.7` | master level for every cue |

### Files added in Phase 5

| File | Responsibility |
| --- | --- |
| `src/render/gestureOverlay.js` | 2D feedback canvas: pinch dots, zoom line + factor, palm ring, fist crosshair, fades |
| `src/render/handSkeleton.js` | the in-scene glowing hand wireframe, slotting, fading, toggle |
| `src/audio/sound.js` | Web Audio graph, synthesized cues, hum, zoom tone, mute/volume, gesture-gated context |
| `src/audio/cues.js` | the pure "when does a cue fire" rule |
| `src/audio/cues.test.js` | 8 unit tests for that rule |
| `src/ui/gestureFeedback.js` | the only coordinator: overlay + skeleton + cues per frame |
| `src/input/demoHand.js` | dev-only synthetic hands (see below) |

`main.js` calls one `gestureFeedback.update(gestureState, dt)` per frame and owns the three
toolbar handlers; nothing else in the gesture path changed.

### Dev aid: hands without a camera

```
http://localhost:5173/?handdemo=pinch   one pinching hand (rotate)
http://localhost:5173/?handdemo=fist    one fist (pan)
http://localhost:5173/?handdemo=palm    one open palm (reset ring, then reset)
http://localhost:5173/?handdemo=two     two pinching hands (zoom)
```

The feed produces exactly what `handTracker.detect()` produces, so it exercises the real
engine, the real overlay and the real skeleton. Combine it with `?model=/samples/knot.glb` to
see the feedback over a model. It is inert without the query parameter.

### Tests

`npm test` now runs 39 checks: the 23 gesture checks from Phase 4, 8 for the cue rule, and 8 for
the audio graph (driven against a fake Web Audio API).

Cue rule: no cues while idle, exactly one grab and one release per hold (300 frames),
edge-triggering in both directions, one zoom start/stop per zoom, rotate -> zoom releasing and
starting the tone without re-grabbing, the reset pulse firing once, pan and palm-hold being
silent in themselves, and repeated grab/release cycles producing one pair each.

Audio graph: no context before a user gesture (every cue stays silent), unlock is idempotent
and starts the two hum carriers plus their LFOs, one oscillator per grab, mute drives the
master gain to 0 and volume scales it, the zoom tone starts once, follows speed and stops, and
dispose closes the context.

### Manual test checklist (Phase 5)

1. Pinch: a glowing dot appears at the pinch, the status reads `Grabbing`, and a short bright
   blip plays the first time you pinch (not every frame).
2. Release: the dot fades, the release tone plays, and the idle spin eases back in.
3. Pinch with both hands and move apart: a dashed line with the live factor appears, the status
   reads `Zooming`, and the tone rises as you spread and falls as you close.
4. Make a fist: a four-arrow crosshair sits on your palm, the status reads `Panning`.
5. Hold an open palm: a ring fills around your palm, then the view eases home with two rising
   notes. Closing your hand early cancels the ring.
6. Press **Hands**: the wireframes disappear; press again and they fade back in.
7. Press **Sound**: everything goes silent and the slider greys out; press again to bring it
   back, then drag the slider — the cues get quieter/louder.
8. Reload and move your hands *before* clicking anything: the visuals react but no audio plays
   until you have clicked once (browser policy), and no console warning appears.
9. Move a hand out of frame: its wireframe fades out rather than vanishing.

### Known limitations (Phase 5)

- **The tones were not heard here** (no speakers in this environment). What the graph does is
  verified against a fake Web Audio API in `src/audio/sound.test.js` - node creation, frequencies,
  envelopes, mute, volume, the zoom-tone lifecycle and dispose - and the browser run shows no
  autoplay warnings. Only the subjective side (timbre, how loud the hum sits under the cues) is
  a matter of taste.
- The skeleton is drawn on a fixed plane in front of the model, not at the hand's true depth:
  it tracks position and shape, not distance from the camera.
- One glow texture and one set of geometries are shared per slot; two simultaneous hands is the
  maximum (matching the tracker's `numHands: 2`).
- The overlay is a 2D canvas on top of the stage, so it is not depth-tested against the model —
  that is deliberate, so feedback always reads clearly.
- No settings UI for the two new sound values beyond the toolbar (no persistence yet).
---

## Phase 6 — hologram style presets and the settings panel

The look is now six switchable presets, and everything that used to be a hard-coded number
is a setting you can change live and keep.

### Presets

| # | Preset | Look |
| --- | --- | --- |
| 1 | Cyan | the original: cyan surface, cyan rim, full fill |
| 2 | Orange | amber body, warm rim, slightly stronger flicker |
| 3 | Green | terminal green, tighter scanlines |
| 4 | Iron Man | gold body with a red-hot rim (`rimColor`), warm glitch |
| 5 | Wireframe | surface hidden, only the wireframe shell |
| 6 | Points | surface hidden, the mesh vertices drawn as a glowing point cloud |

Click a button in the bar (bottom-left) or press its number. The active preset is
highlighted and stored, so a reload comes back to it.

**Transitions are eased, not switched.** Colour and every numeric uniform move toward their
target with `alpha = 1 - exp(-TRANSITION_RATE * dt)` at `TRANSITION_RATE = 6` 1/s, so a
preset change is a ~0.4 s fade rather than a flash. Two structural flags — `wireframeOnly`
and `pointCloud` — switch instantly, because easing visibility would flicker.

Switching is safe at any time: presets only move shader targets and toggle two objects'
`visible` flags. They never touch `state.transform`, so a mid-grab rotate or zoom carries on
undisturbed; there is a test for the eased convergence and one for the instant flags.

### The point-cloud look

`src/render/pointCloud.js` builds, per surface mesh, one `Points` object that **shares the
mesh geometry** (no copy, no re-upload), inherits its transform, and uses an additive,
size-attenuated material with a shared radial-gradient `CanvasTexture`. Points are built
lazily the first time a preset needs them and then toggled by visibility.

### The settings drawer

Open with the **Settings** button or `S`; close with the ✕, `S` or `Escape`. It is generated
from `settings/schema.js`, so a setting exists in exactly one place:

| Group | Setting | Range | Default | What it does |
| --- | --- | --- | --- | --- |
| Gestures | Pinch threshold | 0.10–0.45 | 0.25 | pinch start distance, in hand sizes |
| Gestures | Pinch release | 0.15–0.60 | 0.40 | pinch release distance (hysteresis) |
| Gestures | Fist threshold | 0.60–1.30 | 0.90 | finger curl needed for a fist; release follows proportionally |
| Gestures | Rotate sensitivity | 0.2–3 | 1.0 | multiplier on pinch-drag rotation |
| Gestures | Pan sensitivity | 0.2–3 | 1.0 | multiplier on fist-drag pan |
| Gestures | Smoothing | 0–1 | 0.5 | One Euro strength on every landmark |
| Hologram | Intensity | 0.3–2 | 1.0 | overall hologram brightness |
| Hologram | Scan density | 8–60 | 28 | scanline count, before the preset's own scale |
| Hologram | Flicker | 0–0.6 | 0.14 | flicker depth, before the preset's scale |
| Interface | Volume | 0–1 | 0.7 | audio cue master level |
| Interface | Hand skeleton | on/off | on | the in-scene hand wireframe |
| Interface | Debug overlay | on/off | on | FPS / inference / per-hand numbers |
| Interface | Camera preview | on/off | on | the mirrored preview card |

Every slider applies **on the same frame it moves** — `main.js` has one
`applyLiveSettings()` that pushes the whole settings object into the subsystem that cares
(toolbar, drawer, skeleton, preview, hologram), so the controls can never disagree about the
current values.

**Reset to defaults** restores all of them, re-syncs the drawer, re-applies the default
preset and saves.

### Persistence and validation

```
localStorage["holographic-viewer:settings:v1"] = { ...settings, hologramPreset }
```

- Saving happens in one place: `src/settings/persistSettings.js` subscribes to
  `state:changed` and saves when `keys` includes `settings`. Drawer, toolbar, shortcuts and
  reset all go through it.
- Loading happens before any subsystem is built. Every stored value passes
  `sanitizeStoredSettings()`: non-objects and arrays are ignored, unknown keys are dropped,
  wrong types are dropped (numeric strings are accepted because that is what localStorage
  hands back), numbers are clamped into the schema range, `NaN`/`Infinity` are dropped, and an
  unknown `hologramPreset` falls back to `cyan`. Rejected keys are reported, not thrown.
- Corrupt JSON, a throw from `getItem`, a full quota or private mode all degrade to "use the
  defaults" — reading and writing are individually wrapped, and the app cannot fail to start
  because of storage.
- Applying a restored value is a plain `patchSettings()` call, so there is one code path for
  "the user moved a slider" and "a stored value came back".

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Shift`+`1` … `Shift`+`6` | pick a preset (Phase 7 moved them behind Shift) |
| `S` | open / close the settings drawer |
| `Escape` | close the drawer |

Shortcuts are ignored while a slider, input, textarea or select has focus, so dragging a
slider can never be hijacked by a number key.

### Portrait framing fix

Adding a right-hand drawer made the phone layout worth checking properly, which exposed an
older bug: the camera's vertical field of view is fixed, so on a tall viewport the horizontal
field shrinks and the model was cropped. `cameraDistanceFor(aspect)` in `render/scene.js` now
dollies the camera back along the same sight line until 2.6 world units still fit across.
Landscape screens keep the authored framing exactly; junk aspect values fall back to it.

### Files added in Phase 6

| File | Responsibility |
| --- | --- |
| `src/render/presets.js` | the six presets, `findPreset()`, `createHologramStyle()` (eased transitions), `applyHologramStyle()` |
| `src/render/pointCloud.js` | per-mesh additive point clouds sharing the mesh geometry |
| `src/settings/schema.js` | `SETTINGS_GROUPS`, `SETTINGS_SCHEMA`, `coerceSetting()`, `schemaDefaults()` |
| `src/storage/settings.js` | `sanitizeStoredSettings()`, `pickPersistable()`, load / save / clear |
| `src/settings/persistSettings.js` | the single save-on-change subscription |
| `src/ui/presetBar.js` | the preset buttons (swatch, label, shortcut) |
| `src/ui/settingsPanel.js` | the drawer, generated from the schema |
| `src/settings/settings.test.js` | storage, validation, and the persistence wiring end to end |
| `src/render/presets.test.js` | the preset table and the eased transitions |
| `src/render/scene.test.js` | the aspect-aware camera framing rule |
| `public/mobile-check.html` | dev aid: renders the app in a 390×560 iframe so the phone layout can be checked in a desktop browser |

`state.js` now takes its panel defaults from `schemaDefaults()`, so a slider can never offer a
value the validator would reject, and a default cannot drift between the three places that
care about it (drawer, sanitiser, state).

### Tests

At the end of Phase 6, `npm test` ran 71 checks: the 39 from Phases 4–5, 17 for settings (13
storage/validation plus 4 integration), 10 for the presets and 5 for the camera framing rule.
Phase 7 adds 39 more; see its Tests section for the current total.

Persistence: every schema default validates; valid numbers/booleans survive; out-of-range
values clamp; corrupt values (`"abc"`, `null`, `NaN`, `Infinity`, wrong boolean type, unknown
keys) are dropped; numeric strings are accepted and junk strings are not; unknown preset ids
fall back; non-object payloads are ignored; only schema keys and the preset are written; a
save/load round trip is exact; corrupt JSON yields defaults; a quota error and a missing
`localStorage` are survivable.

Integration (the real wiring, not a copy of it): a settings change emitted by `state.js`
reaches storage through `attachSettingsPersistence()` and reads back through the validator; a
transform change never touches storage; detaching stops further writes; a corrupted store
still boots with defaults and a usable preset.

Presets: the six ids, unique digit shortcuts, unknown-id fallback, the structural flags,
colour round-tripping, eased convergence onto the target, no overshoot (monotonic), instant
switching, structural flags applying before the first frame, and zero/negative `dt` producing
no `NaN`.

Framing: landscape keeps the authored distance, portrait viewports always show at least 2.6
units across, a 390×760 phone viewport is not cropped, the distance grows monotonically as
the viewport narrows, and junk aspect ratios fall back.

### Manual test checklist (Phase 6)

1. Click each preset in turn: the look changes smoothly (~0.4 s), the clicked button stays
   highlighted, and the model keeps its orientation, size and position.
2. Press `Shift`+`1`–`Shift`+`6` (bare `1`–`4` are the Phase 7 modes): the same thing, from the
   keyboard.
3. Choose Wireframe, then Points, then Cyan: the surface disappears for wireframe, the cloud
   appears for points, and the solid hologram comes back.
4. While holding a pinch-drag (or `?handdemo=pinch`), switch presets with the other hand on
   the keyboard: the drag continues without a jump.
5. Open **Settings**, drag *Hologram intensity* and *Scan density*: the model responds while
   you drag, and the number beside each slider follows.
6. Untick *Camera preview*: the preview card disappears. Untick *Hand skeleton*: the
   wireframes go. Untick *Debug overlay*: the numbers panel goes.
7. Drag *Rotate sensitivity* to 3, pinch-drag: rotation is much faster. Set it back to 1.
8. Press **Reset to defaults**: every slider returns, the preset returns to Cyan, and the
   toast confirms.
9. Change a few settings and a preset, then reload: everything comes back.
10. In DevTools, set `localStorage['holographic-viewer:settings:v1']` to `{"pinchStartThreshold":"abc","hologramPreset":42}`
    and reload: the app starts normally on Cyan with the defaults and no console error.
11. Set it to `not json at all` and reload: same result.
12. Press `S` to open the drawer and `Escape` to close it; press `S` again to reopen.
13. Narrow the window to phone width (or open `public/mobile-check.html`): the toolbar collapses
    to icon buttons, the preset bar drops to swatches only on one row, and nothing overflows
    horizontally.

### Known limitations (Phase 6)

- **Cross-launch persistence could not be shown in this environment**: the automated browser
  starts with a fresh profile each launch, so `localStorage` is empty every time. The write
  path is covered end to end by the integration tests (real `state.js` → real
  `attachSettingsPersistence()` → real `saveSettings()` → validated reload), and reload
  behaviour inside one session is the same code path. One human click-through confirms it.
- The Iron Man preset's two-tone rim uses a second uniform (`uRimColor`); the wireframe
  material keeps `rimIntensity` at 0, so the rim colour is a no-op there.
- Point clouds are built per mesh at preset-selection time; a model with thousands of meshes
  would notice the first switch. Vertices are never re-uploaded.
- Preset transitions are exponential and time-based, not spring-based: they are smooth but
  not bouncy.
- `showWebcam` hides the preview but does not stop the camera; tracking keeps running so
  gestures still work.
- The drawer is a fixed panel, not a modal: it does not trap focus, and it can be open while
  you drag the model behind it.
- `fistThreshold` is tunable but `PALM_THRESHOLDS`, `ACTIVATION_FRAMES` and the palm hold time
  remain constants.
- The mobile harness (`public/mobile-check.html`) is a development aid, not part of the app.
---

## Phase 7 — Orbit, Slice, Explode and Inspect

Four tools, one at a time. A mode bar above the stage picks between them, and every mode has
three ways in: hands, mouse, and a slider — so nothing here needs a camera.

### The mode bar

```
Orbit   Slice   Explode   Inspect        ← pills, active one highlighted
```

It sits under the toolbar, centred, with a second thin strip under it whose contents change
with the mode: axis buttons and a position slider for Slice, an amount slider for Explode, a
part readout for Inspect, and a one-line hint for Orbit. Click a pill or press `1`–`4`.

- Modes change **only** from the toolbar or those keys. No gesture switches modes, so a
  pinch can never silently start cutting the model.
- The shortcuts are read through one pure function, `shortcutIntent(key, { shift })`, in
  `tools/modeState.js`; that is also where presets moved to `Shift`+`1`–`6` when the modes
  took the bare digits.
- On narrow screens the pills drop their number badges and the hint is hidden; in Orbit the
  now-empty strip is hidden too (`.mode-bar.is-quiet`), so a phone shows one capsule, not two.

### Vertical pinch-drag is routed by mode

Horizontal pinch-drag always rotates the model, in every mode, exactly as it did in Phase 3.
What the *vertical* travel does is now decided per mode by `verticalDragTarget(mode)`:

| Mode | Vertical pinch-drag |
| --- | --- |
| Orbit | pitches the model (the Phase 3 behaviour) |
| Slice | moves the cutting plane |
| Explode | sets the explosion amount |
| Inspect | nothing |

The engine reports the raw vertical travel (`dragY`) and `main.js` sends it to the transform
in Orbit, to `patchTool()` in Slice/Explode, and drops it in Inspect. `delta.rotX` is
suppressed in the modes that consume the vertical axis, so the model cannot pitch and cut at
the same time.

Switching modes mid-gesture is clean because the two consumers are absolute, not
incremental: the plane sits at a position and the explosion at an amount, and both are
clamped. There is no accumulated delta to replay, and the pinch anchor is retaken on the
first frame of the new mode, so nothing jumps.

### Slice

A clipping plane through the model, at `renderer.localClippingEnabled = true`.

- `slicePlane(axis, position)` (pure, in `tools/slice.js`) returns `{ normal, offset,
  position }` with the convention `dot(n, p) - offset = 0`. Position runs `-1 … 1` over
  `SLICE_RANGE = 0.85` of the model's size, so the ends of the travel clear the geometry
  instead of leaving a sliver.
- The custom hologram shader honours the plane: `clipping_planes_pars_fragment`,
  `clipping_planes_fragment`, the vertex pair, and `uClipping`-free standard attributes. The
  plane is assigned to every hologram material *and* the wireframe shell, and the renderer
  recompiles each material's program when the plane count changes (`getHologramMaterials()`
  + `setClippingPlanes()` in `render/hologramMaterial.js`).
- Only the surface tells you where the cut is, so `render/sliceSection.js` also draws a
  glowing seam: the model's triangles are baked **once** in wrapper space, then each change
  converts the world plane into that space, intersects it (`sectionSegments()`), and fills a
  preallocated `LineSegments` buffer. Because the line is a child of the wrapper it follows
  rotation, pan and zoom for free.
- Axis buttons `X` / `Y` / `Z`, and the slider is the mouse alternative to the pinch-drag.

### Explode

For a model with more than one mesh, each part moves out along the direction from the model's
centre to its own centre, by `amount * EXPLODE_DISTANCE` (`1.15` model units).

- `render/explodeModel.js` captures, per part, the original `position` and a direction
  computed from the world bounding-box centre transformed back through
  `inverse(wrapper.matrixWorld)` — so the directions are correct whatever rotation or scale
  the model is being viewed at.
- `apply(amount)` writes `original + direction * amount * EXPLODE_DISTANCE`; `restore()`
  writes the original back. Because the originals are kept verbatim, amount 0 restores the
  model **exactly**, not approximately (there is a test for bit-equality).
- A part sitting exactly on the centre has no direction; `fallbackDirection()` gives it a
  golden-angle direction with an alternating vertical component so two such parts never
  overlap.
- A single-mesh model has nothing to separate, so the slider is disabled and the strip says
  `Single mesh — nothing to separate` rather than pretending to work.

### Inspect

The pointer — the mouse, or the index fingertip while pointing — is raycast into the scene and
the first real mesh under it is highlighted and named.

- The label comes from the mesh name in the file. Files routinely ship meshes with no name
  (or `''`), so `partLabel(name, index, total)` falls back to `Model` for a lone part and
  `Part 2 of 5` for several. Labels longer than 64 characters are truncated by CSS.
- The highlight is a rim boost plus a colour shift applied through the existing
  `applyHologramOptions()`; it is re-applied every frame on purpose, because the preset/style
  pass owns those uniforms and would otherwise erase it a frame later.
- The label is positioned from the projected hit point in `main.js`, clamped to the stage, and
  hidden the moment nothing is hit — no stale name is ever left on screen.
- In the strip, `nothing under the pointer` stands in for the empty label.

### Mouse and slider parity

| Mode | Hands | Mouse | Slider / buttons |
| --- | --- | --- | --- |
| Orbit | pinch-drag, fist, palm | drag, right-drag, wheel, double-click | — (unchanged) |
| Slice | vertical pinch-drag | the position slider | X / Y / Z buttons |
| Explode | vertical pinch-drag | the amount slider | — |
| Inspect | index fingertip | hover | — |

Nothing in Phase 7 needed a gesture to be reclassified: the modes only read what Phase 4
already produced.

### Reset rules

- **Mode change**: `slicePosition` and `explode` ease back to 0 (the explosion returns home
  smoothly rather than snapping), the inspect label clears, and the seam is dropped. Rotation,
  zoom and pan are untouched — a mode change never moves the camera.
- **Model load**: tool state is reset, the baked triangles are rebuilt for the new geometry,
  the explode originals and directions are recaptured, and the inspector forgets the old
  meshes so it cannot highlight a disposed object.
- **Load failure**: the current model and the current tool state stay exactly as they were.

### Files added in Phase 7

| File | Responsibility |
| --- | --- |
| `src/tools/modeState.js` | `TOOL_MODES`, `MODE_IDS`, `DEFAULT_MODE`, `SLICE_AXES`, `isToolMode()`, `modeForShortcut()`, `shortcutIntent()`, `verticalDragTarget()` |
| `src/tools/slice.js` | pure slice maths: `SLICE_RANGE`, `normalForAxis()`, `slicePlane()`, `sectionSegments()` |
| `src/tools/explode.js` | pure explode maths: `EXPLODE_DISTANCE`, `directionFromCenter()`, `fallbackDirection()`, `offsetFor()` |
| `src/tools/toolController.js` | the live side: creates the plane/seam/parts/inspector, applies tool state, exposes `explodeInfo()`, resets on model load |
| `src/render/sliceSection.js` | bakes model triangles, converts the world plane to wrapper space, rebuilds the seam buffer |
| `src/render/explodeModel.js` | captures original positions and directions, `apply()` / `restore()` / dispose |
| `src/render/inspect.js` | `partLabel()`, `createInspector()` (raycast, highlight, label text) |
| `src/ui/modeBar.js` | the pills, the per-mode strip, axis buttons, both sliders, the notice and the readout |
| `src/tools/modeState.test.js` | 9 checks: the mode table, shortcuts, drag routing |
| `src/tools/slice.test.js` | 10 checks: plane construction, clamping, segments on a synthetic cube |
| `src/tools/explode.test.js` | 8 checks: directions, the centre fallback, offsets, exact restore |
| `src/render/inspect.test.js` | 7 checks: name fallback, truncation, label lifecycle |
| `src/input/gestures.delta.test.js` | 5 checks: the raw vertical travel the tools consume |
| `public/samples/parts.obj` | three boxes as three `o` groups, so Explode and Inspect can be exercised |

`hologramMaterial.js` gained the clipping includes and `setClippingPlanes()`;
`gestures.js` gained `dragY`; `scene.js` enables local clipping; `styles.css` gained the mode
bar, the axis buttons, the two sliders and the inspect label.

### Tests

`npm test` now runs **110 checks**, 110 passing: the 71 from Phase 6 plus 39 for this phase —
9 for the mode table and keymap, 10 for the slice maths, 8 for the explode maths, 7 for the
inspector's naming, and 5 for the vertical travel the gestures hand over.

Modes and keys: every mode has a unique id, label, shortcut and hint; `1`–`4` map to the four
modes and nothing else does; `Shift`+`1`–`6` map to presets while bare `1`–`6` do not; unknown
modes and axes are rejected; the vertical drag routes to `pitch` / `slice` / `explode` /
`none` per mode.

Slice: the plane sits at the requested offset on each axis with the right normal sign; the
position clamps to `-1 … 1`; a position past the model's extent produces no segments; a plane
through a synthetic cube yields the expected number of segments in the right plane; a plane
that only touches an edge or a vertex produces no duplicate segments; degenerate triangles are
skipped rather than emitted as `NaN`.

Explode: each part's direction points away from the centre; `amount` 0 restores the exact
original positions; `amount` 1 is `EXPLODE_DISTANCE` along the direction; out-of-range values
clamp; a part on the centre falls back to a non-zero direction; two coincident parts get
different fallback directions; the offsets are independent of the wrapper's rotation and scale.

Inspect: a real name is used verbatim; an empty, whitespace-only or missing name falls back to
`Model` / `Part n of m`; long names are truncated at 64 characters; the label clears when the
pointer leaves the model; a mesh with no material never throws.

Vertical travel: the engine reports the raw drag for the router, `delta.rotX` stays zero in the
modes that consume it, and orbit still pitches.

### Manual test checklist (Phase 7)

1. Press `1`–`4`: the pill highlights, the strip changes, and nothing on the model moves.
2. Orbit: drag, pinch-drag and fist-drag behave exactly as in Phase 4.
3. Slice: pick `Y`, drag the slider from `-1` to `1`. The model is cut where the plane sits,
   a bright seam traces the cut, and the model is whole again at both ends.
4. Slice with hands (`?handdemo=pinch`): vertical pinch-drag moves the cut, horizontal still
   rotates. The HUD reads `Grabbing`.
5. Press `X`, then `Z`: the cut follows the axis without jumping.
6. Switch Slice → Orbit while still pinching: the cut returns to 0 smoothly and the model
   keeps rotating without a jump.
7. Load `?model=/samples/parts.obj`, choose Explode, drag to 100%: the three boxes separate
   along their own directions, smoothly. Back to 0%: they return to exactly their old places.
8. Load `?model=/samples/knot.glb`, choose Explode: the slider is disabled and the strip says
   why.
9. Inspect, then hover each box: the pointed part brightens, the floating label names it
   (`Core`, `ArmLeft`, `ArmRight`), and moving off the model hides the label.
10. Inspect with `?handdemo=pinch`: the overlay's pinch point drives the raycast, so the
    label follows your hand.
11. Load a new model while in Slice or Explode: the strip resets, the seam is rebuilt for the
    new geometry, and no ghost seam or offset box is left behind.
12. Narrow the window to 390 px (or open `public/mobile-check.html`): the four pills fit on
    one row, the strip fits under them, and the presets stay clear of the camera card.

### Known limitations (Phase 7)

- **Slice clips; it does not cap.** The cut leaves the model's interior open — what makes it
  read as a solid cut is the seam line, not a filled cross-section. Capping would need a
  stencil or a triangulated cap per frame.
- The seam is computed on the CPU from baked triangles, capped at 90 000 triangles and
  sampled evenly beyond that, so on a very dense model the seam is an approximation while the
  clipping itself stays exact (the GPU does the cutting).
- Explode moves whole meshes. A single-mesh model cannot be exploded at all, which is why the
  notice exists rather than a slider that does nothing.
- Inspect is one ray at the pointer (or index fingertip), not a cone: very thin geometry can
  be missed at glancing angles.
- The slice plane is axis-aligned only (X / Y / Z); there is no free-orientation cutting.
- Tool state is view state and is deliberately **not** persisted: a reload starts in Orbit
  with no cut and no explosion.
- The seam and inspect label are not depth-tested against the model — deliberate, so feedback
  always reads.
- **The hand side of every mode was exercised with the synthetic `?handdemo=pinch` feed and
  the sliders, not a live camera.** The routing, the maths and the resets are covered by the
  39 automated checks; one human pass with a real camera is the remaining confirmation.

---

## Phase 8 — saved models, screenshots and video capture

Three things the viewer was missing: a model you loaded once is still there after a reload,
the view can be saved as an image, and it can be recorded to a video file. All of it stays
local — IndexedDB for models, a download for anything you capture.

### The library

Load a model and it is stored, with a thumbnail of how it looked at that moment. The
**Library** button in the toolbar (or the left-hand panel it opens) lists everything saved,
newest first:

```
┌─ Library ───────────── 1 model · 4.1 MB ─┐
│ [thumb]  parts.obj                        │
│          912 B · added 3 minutes ago   ×  │
└───────────────────────────────────────────┘
```

- Click a card to load it. It goes through the **same** `handleFiles()` path a fresh upload
  takes (`save: false`, so it is not stored twice), which means a library model behaves
  exactly like a dropped file: same parsing, same normalisation, same tools reset.
- `×` deletes that model from storage. The card's delete button stops the click from also
  loading the file.
- The panel slides in from the **left**, so it can be open at the same time as the settings
  drawer (right).
- Empty, loading, error and "storage unavailable" are four different states with different
  text — "Nothing saved yet" never stands in for a broken database.
- On a phone, loading from the panel closes it, because it would otherwise cover the model
  it just loaded.

### How a model is stored

Two object stores, not one:

```
holographic-viewer (v1)
  models  { id, name, size, type, addedAt, thumbnail }   metadata only
  blobs   { id, blob }                                   the file itself
```

Split on purpose: listing the library runs `getAll()` on `models` alone, so a library of
50 MB of models never pulls 50 MB through the main thread just to draw six cards. Deleting is
one `readwrite` transaction across both stores, so a record can never end up with no bytes
behind it.

Two behaviours worth knowing:

- **Every storage call degrades instead of throwing.** `putModel` / `listModels` /
  `getModelBlob` / `deleteModel` / `clearModels` each return a result object
  (`{ ok: true, ... }` or `{ ok: false, code }`), where `code` is
  `unavailable | quota | blocked | invalid | unknown`. A missing IndexedDB, a blocked
  origin, a full quota and a private-mode window all end as a sentence in a toast, never as
  an uncaught error.
- **Duplicate detection keeps one entry per file.** A file with the same name and size as an
  existing record replaces it (`fileSignature`), so reloading the sample six times does not
  leave six cards.

Thumbnails are a centre-cropped square JPEG of the live canvas (`THUMBNAIL_SIZE` 320,
`THUMBNAIL_QUALITY` 0.72). JPEG rather than PNG because a glowing gradient compresses about
ten times smaller, and `captureThumbnail()` returns `null` instead of throwing — a thumbnail
problem may never fail a model load.

The thumbnail is taken from the **on-screen** canvas, not a second render pass: loading
queues `pendingSaveFile`, and the loop drains it right after `scene.render()` has drawn the
new model.

### Screenshot

**Shot** saves a PNG of the hologram. UI is never in it, because the toolbar, the cards and
the HUD are DOM elements outside the WebGL canvas.

It renders into a `WebGLRenderTarget` and reads the pixels back, rather than calling
`canvas.toDataURL()`, for two reasons: the renderer is created with `alpha: false` and
without `preserveDrawingBuffer` (so `toDataURL` would come back black), while a render target
keeps alpha — which is what makes the transparent option work without rebuilding the
renderer.

The hand skeleton is hidden for the capture and restored afterwards: hands are feedback, not
part of the model. Output is named `hologram-YYYY-MM-DD-HHMMSS.png` and capped at
`MAX_SCREENSHOT_EDGE` 4096 px.

### Recording

**Record** captures the real WebGL canvas through `canvas.captureStream(30)` and
`MediaRecorder`, so the video is exactly what is on screen. The button turns red, pulses and
counts: `REC 0:03`. Pressing it again stops, and the file downloads as `.webm` (or `.mp4`
where that is all the browser offers).

- **The mime type is chosen by feature detection**, not assumed: vp9 → vp8 → webm → mp4/avc1
  → mp4, first one `MediaRecorder.isTypeSupported()` accepts. When none is supported the
  button is disabled with "this browser has no supported recording format" as its title,
  instead of failing after the user has already recorded something.
- **Chunks arrive every second** (`start(1000)`), so an hour-long recording does not have to
  fit in memory as one growing blob.
- **Include webcam** (a setting) composites a webcam inset into the bottom-right corner. That
  frame is drawn from the app's single `requestAnimationFrame` loop — there is no second loop
  and no second render. Without the option, no 2D canvas is created at all.
- The recorder reports its own elapsed time from `performance.now()`, and the composite is
  redrawn at most every `TICK_INTERVAL_MS` (200 ms).
- An empty recording is reported as a failure — "the browser could not encode the frames" —
  rather than downloading a 0-byte file.

### New settings

| Setting | Type | Default | Effect |
| --- | --- | --- | --- |
| `transparentScreenshots` | boolean | `false` | save the PNG with a transparent background |
| `recordWithWebcam` | boolean | `false` | composite the webcam preview into recordings |

Both live in the Interface group of the drawer, and both take effect on the next capture —
nothing is rebuilt when they change.

### Files added in Phase 8

| File | Responsibility |
| --- | --- |
| `src/storage/db.js` | IndexedDB: two stores, `withTransaction`, error classification, no throwing |
| `src/library/records.js` | pure record rules: sanitise, sort newest-first, `formatBytes`, `formatAddedAt`, signatures, `toFile()` |
| `src/library/thumbnail.js` | centre-cropped square JPEG of the live canvas, `null` on failure |
| `src/capture/frames.js` | pure capture rules: mime candidates, filenames, `formatDuration`, error text, size fitting |
| `src/capture/screenshot.js` | render-target PNG, row flip, un-premultiply for transparency, `downloadBlob` |
| `src/capture/recorder.js` | `recordingSupport()`, MediaRecorder lifecycle, chunk assembly, webcam composite |
| `src/ui/library.js` | the collapsible panel: cards, thumbnails, per-card delete, four states |
| `verify-capture.mjs` | dev aid: drives a real Chrome over CDP to check the library, a screenshot and a recording |
### Tests

`npm test` now runs **150 checks**. Phase 8 added 40:

| File | Checks | What it pins down |
| --- | --- | --- |
| `src/library/records.test.js` | 11 | signature / duplicate detection, sorting, `formatBytes`, `formatAddedAt`, `sanitizeRecord`, `toFile` |
| `src/capture/frames.test.js` | 10 | mime preference order and fallback, extensions, filenames, `formatDuration`, capture error text, size fitting |
| `src/storage/db.test.js` | 6 | the unavailable path: every call degrades with the right code, nothing throws |
| `src/storage/library.integration.test.js` | 6 | the real round trip against `fake-indexeddb`: save → list → read the bytes back → delete → clear, newest-first order, and a save that survives a closed connection |
| `src/capture/recorder.test.js` | 7 | support reasons, stream set-up, chunk assembly into one file, the composite geometry, the empty-recording failure, `dispose()` |

The integration test is the one that matters most: it drives the actual `db.js` against a real
IndexedDB implementation, so "models persist across reloads" is checked rather than assumed.
It immediately paid for itself — it caught a bug where `withTransaction` resolved the *promise*
of a request instead of its value, so every read came back empty while every write reported
success.

### Browser verification

`verify-capture.mjs` drives a real headless Chrome over CDP and checks what unit tests cannot:

```bash
npm run dev            # in one shell
npm run verify:capture # in another
```

Latest run:

```
  · library: 1 card, summary "1 model · 912 B"
  · library: the saved model survived a reload
  · screenshot: 30132-byte PNG
  · recording: timer reached "REC 0:03"
  · recording: this browser encoded no frames (headless encoder limitation)
  · library: deleted, summary now "No saved models"

PASS
```

### Dev aid: put a model in the library without a picker

```
http://localhost:5173/?savelib=1&model=/samples/parts.obj
```

`savelib=1` stores the preloaded model, so the whole persist → reload → select → delete path
can be exercised without touching a file dialog. Without it, `?model=` loads but does not
save — a dev preload must not fill the user's library.

### Manual test checklist (Phase 8)

1. Load `knot.glb`, open **Library**: one card with a thumbnail of the knot, its size and
   "added just now".
2. Reload the page and open the library: the card is still there.
3. Click the card: the model comes back exactly as it was (same framing, no duplicate card).
4. Press `×`: the card disappears, a toast confirms, and a reload shows an empty library.
5. With a model loaded, press **Shot**: a PNG downloads and opens showing the hologram with no
   toolbar, no cards, no HUD, and no hand skeleton.
6. Turn on "Transparent shot" in the settings drawer and shoot again: the background is
   transparent when you open the file.
7. Press **Record**, wait a few seconds and press it again: the button pulses with a live
   `REC 0:0X` counter while recording, and a `.webm` downloads on stop.
8. Turn on "Record with camera" and record: the video has your webcam inset in the bottom
   right, moving with you.
9. Deny or block storage (private window): the library shows its "unavailable" notice, and
   loading, orbiting, screenshot and recording all still work.
10. Delete a model and immediately reload: it stays deleted.

### Known limitations (Phase 8)

- **The recording could not be produced in this environment.** Headless Chrome reports every
  webm/mp4 mime as supported, hands back a live video track, and then delivers **zero encoded
  chunks** — and it does the same for a plain 2D canvas the app never touches, so it is the
  headless encoder, not the recorder. Everything around it is verified: the state machine, the
  timer, the support checks, the chunk assembly and the composite geometry are covered by the
  seven recorder tests, and the button behaviour was checked in a real browser. One recording
  on a normal desktop browser is the remaining confirmation.
- Screenshots are capped at 4096 px on the long edge, so a 5K window is saved slightly smaller
  than it looks on screen.
- Recording captures the canvas at up to 30 fps at whatever size the window is; there is no
  fixed resolution and no bitrate control beyond the `videoBitsPerSecond` default.
- The library stores the model file as-is. A 200 MB model will hit the browser's quota, which
  is reported as "Storage is full" rather than pre-empted — there is no size warning before
  saving.
- Thumbnails are 320 px JPEGs; on a deliberately transparent or empty frame they can look
  washed out. They are a way to recognise a file, not a saved view.
- Library loads go through the loader, so a model saved by an older build that somehow stored
  an unreadable file surfaces as the normal parse error, not as a storage error.
- Deletion is immediate and has no undo.

## Phase 9 — touch input, quality levels and head parallax

Three additions that stop the viewer being a desktop-only, one-speed,
camera-only experience:

1. **Touch** — one finger orbits, two pinch and pan, with no mode switch and no
   page scrolling underneath.
2. **Quality levels** — Low / Medium / High bundled into one decision, plus a
   watchdog that steps down when the measured frame rate cannot keep up.
3. **Head parallax** — the camera leans with your head, so the model reads as a
   volume in front of you rather than a picture of one.

### Touch: one finger, two fingers

`src/input/touchGestures.js` is pure arithmetic and produces exactly the three
deltas the mouse already produced, so nothing downstream had to change:

| Fingers | What it does | Delta returned |
| --- | --- | --- |
| 1 | orbit (horizontal turns, vertical pitches) | `{ kind: 'rotate', dx, dy }` |
| 2 | pan by the centroid, zoom by the span ratio | `{ kind: 'pinch', dx, dy, zoomFactor }` |
| double-tap | reset the view, same as a double-click | — |

Two rules make it feel right:

- **A change in finger count is an anchor, never a movement.** Putting a second
  finger down moves the centroid and creates a span out of nothing; applying that
  as a delta would snap the model. The first frame after a count change returns
  `kind: 'none'`, so the gesture always starts from where you actually are.
- **The vertical part still belongs to the active mode.** A one-finger drag calls
  the same `onVerticalDrag` consumer the mouse uses, so in Slice or Explode
  dragging up moves the plane or the parts instead of pitching the model.

The controller (`src/input/mouseControls.js`) keeps touch pointers in their own
map, separate from the mouse drag, so a finger and a mouse cannot fight over one
`dragMode`. `sortPointers` orders them by `pointerId` so "the same finger" stays
the same entry from frame to frame.

`touch-action: none` on the stage (and `-webkit-touch-callout: none`) is what
makes this possible at all: without it the browser eats a one-finger drag as a
page scroll and a two-finger pinch as a zoom of the whole page.

### Quality levels

`src/perf/quality.js` defines three levels, cheapest first. A level bundles the
four things that actually cost frames, so "Low" is one decision rather than four
sliders that can contradict each other:

| Level | Pixel ratio | Hands | Face | Effects |
| --- | --- | --- | --- | --- |
| Low | 1x | 15 Hz | 2 Hz | 0.4x |
| Medium | 1.5x | 30 Hz | 3 Hz | 0.75x |
| High | 2x | every frame | 5 Hz | 1x |

- **Pixel ratio** is `min(devicePixelRatio, 2, level)`, so an expensive 3x phone
  still renders at 2x on High and at 1x on Low.
- **Detection rates** are gated per frame by `handsDue()` / `faceDue()`. A frame
  that skips hand detection re-runs the gesture math on the **last sample**.
  The landmarks have not moved, so the drag delta is zero (a stale delta is not
  applied again) and a pinch, fist or palm stays latched. Feeding an empty hand
  list instead would drop the gesture and reset the 3-frame stability gate.
- **Shader effects** scale flicker and glitch with the level (that is the
  "Effects" column). Scanline density stays the user's setting.

The third piece is the watchdog. Rather than guess from the device, it watches
the measured frame rate: below 30 fps for a continuous 5 seconds and it steps
**one** level down, then starts again. It only ever steps down — climbing back up
on a momentary spike would flap — it stops at Low, and a manual pick in the drawer
resets its history and wins.

### Head parallax

`src/render/parallax.js` turns a head position into a camera offset. Three
details make it read as depth rather than drift:

- **The camera moves opposite the head.** Lean right and you see the model's left
  side, exactly as if you moved your head around a real object.
- **The offset is tiny and clamped** — 0.34 world units on a 1.6-unit model. It
  moves the camera *position* while the look-at point stays on the model, which
  is what changes the viewing angle; moving both would just slide the picture.
- **It never touches `state.transform`.** Hand-gesture accuracy is untouched, and
  the two systems cannot fight because they write to different things.

Calibration is automatic: enabling the feature takes the first face sample as
"neutral", so switching it on never moves the view. The **Recalibrate** button in
the HUD does it again on demand (useful after shifting in your chair). A sample
that jumps more than 0.4 normalized units is treated as a tracking glitch and
dropped.

Face detection runs at 2–5 Hz, and the "no face" timeout is 400 ms — shorter than
the Low interval — so a skipped frame must not look like the face left. Frames
that skip detection call `hold()`, which keeps the last accepted pose fresh.
One empty detection is ignored (a blink, or a single failed inference). The
second in a row, or 400 ms with no hold at all (camera gone), eases the camera
home rather than snapping. The offset only ever moves the camera.

The face model is loaded **lazily** — only when the feature is first switched on
— so the 3.7 MB detector is never downloaded by someone who does not use it.

### Performance HUD

A pill in the top-right, hidden unless asked for. "FPS counter" adds
`<n> fps · <level>` (the level tinted amber at Low, green at High), and "Head
parallax" adds a status line with the **Recalibrate** button. Both are off by
default; the HUD disappears entirely when both are off, and the readout updates
at 4 Hz rather than every frame so it never becomes the cost it measures.

### New settings (Performance group)

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `quality` | select | `medium` | Low / Medium / High; applied live |
| `autoQuality` | boolean | `true` | let the watchdog step down on a slow machine |
| `showFps` | boolean | `false` | show the frame-rate pill |
| `parallax` | boolean | `false` | lean the camera with your head |
| `parallaxStrength` | number | `0.6` | parallax depth, 0..1 |

The drawer gained a `select` control type for this: `settings/schema.js` now
supports `type: 'select'` with an `options` list, `coerceSetting` accepts only a
value from that list (an unknown id is rejected, so the default survives), and
`settingsPanel` renders it. Persistence needed no change — the payload copies
schema keys, and a string round-trips like any other value.

### Files added in Phase 9

| File | Purpose |
| --- | --- |
| `src/input/touchGestures.js` | centroid, span, `touchDelta`, `sortPointers` — pure |
| `src/perf/quality.js` | the three levels, `handsDue` / `faceDue` / `effectScale`, `createAutoQuality` |
| `src/render/parallax.js` | `headToOffset`, `approach`, `createParallax` — pure |
| `src/input/faceTracker.js` | MediaPipe FaceLandmarker wrapper, same error style as the hand tracker |
| `src/ui/perfHud.js` | the FPS / parallax pill and its Recalibrate button |

Modified: `input/mouseControls.js` (touch path), `render/scene.js`
(`setCameraOffset`, `setPixelRatio`), `settings/schema.js` (select type + five
settings), `ui/settingsPanel.js` (select control), `main.js` (wiring), and
`styles.css` (HUD, select, `touch-action`).

### Tests

`npm test` now runs **218 checks**, all passing. Phase 9 added the touch, quality and parallax checks, plus one that a repeated hand sample does not repeat a drag:

| File | Checks | What it pins down |
| --- | --- | --- |
| `src/input/touchGestures.test.js` | 19 | centroid, span, the count-change anchor rule, pan/zoom signs, the 2x zoom clamp, the minimum pinch span, pointer ordering |
| `src/perf/quality.test.js` | 22 | level ordering and immutability, unknown-id fallbacks, pixel-ratio caps, detection gating, and every watchdog path — no downgrade on a healthy rate, one step per window, recovery, stop at Low, manual override |
| `src/render/parallax.test.js` | 23 | frame-rate independence, easing convergence, offset direction and clamp, calibration, glitch rejection, the return to neutral on timeout, and the throttle hold (a 500 ms gap does not jitter; one miss holds, two release) |

Two of these caught real bugs rather than confirming behaviour:

- The watchdog used `0` as its "no window running" sentinel, so a first low
  sample at `nowMs === 0` — which is exactly what `performance.now()` returns at
  page load — threw the window start away and the downgrade never fired. Fixed by
  using `null`.
- `headToOffset` returned `-0` for an unmoved head, which is invisible on screen
  but makes "did the view move?" comparisons surprising. The zero cases are now
  explicit.

### Manual test checklist (Phase 9)

1. Open the page in Chrome DevTools device emulation (or a phone). Drag with one
   finger: the model orbits. The page does not scroll and nothing else moves.
2. Pinch with two fingers: it zooms. Two-finger drag: it pans. Put a second
   finger down mid-drag: the model does not snap.
3. In Slice mode, drag one finger vertically: the slice plane moves, not the
   pitch. In Orbit mode the same drag pitches the model.
4. Settings → Performance → Quality: pick **Low**. The render softens slightly
   (1x pixels), and the HUD, once shown, reads "Low".
5. Shrink the browser window until the frame rate drops below 30 for five
   seconds: a toast reports the drop and the HUD level changes to Low. It never
   climbs back on its own.
6. Turn on **FPS counter**: the pill appears with a live number and the level.
   Turn it off: the pill disappears.
7. Turn on **Head parallax**: the toast asks you to hold still, the status line
   goes to "Parallax · tracking" and the view shifts as you lean. It does not
   change while you are still.
8. Lean far to one side: the offset stops at the clamp. The view does not pulse
   while you hold still, including on Low quality. Walk out of frame: after
   about a second the view eases back to neutral, with no snap.
9. Press **Recalibrate** while sitting off-centre: the view re-centres on where
   you are now, with no jump.
10. Reload: quality, parallax and the HUD toggles are all remembered. Reset to
    defaults turns everything off and Medium back on.
11. Block the camera and switch parallax on: the status says "Parallax · no face",
    the view does not move, and nothing throws.

### Known limitations (Phase 9)

- A face in front of the webcam is still the check for the lean itself. This
  environment's camera had no face in frame, so the verified path is the one
  that matters there: parallax turns on, the status reads "Parallax · no face",
  and the view stays put. Quality, the FPS counter, settings persistence, and
  touch dragging were exercised in the browser. A real phone is still the best
  check for two-finger pinch feel.
- Parallax is **positional only, one face**. With two people in frame it tracks
  whichever face MediaPipe reports first; there is no "ignore other people" logic.
- The face tracker adds real cost (~10-15 ms per detection). It runs at 2-5 Hz by
  level, which is enough for a smooth lean but means a fast head movement trails
  the smoothed camera by a couple of frames.
- `parallaxStrength` scales the clamp, not the smoothing, so setting it to 0
  keeps the face detection running for no visible effect.
- Touch has no inertia: lift a finger mid-drag and the model stops immediately.
  The hand gestures keep their throw, the mouse keeps its easing; touch does not
  have one yet.
- Three-finger touch is handled as a pinch (mean span), not as its own gesture.
- The watchdog can only go down. A machine that was throttled once — say by a
  background compile — stays at the lower level until the user picks a higher one
  or the setting is reset.
- Quality does not affect the model's geometry or the number of meshes, only the
  pixel ratio, detection rates and shader flicker.

**Phase 9 complete.**

## Phase 10 - Final audit

No new controls. The bugs below were in the running app; each fix is one change.

| Edge case | Fix |
| --- | --- |
| A thrown error inside one frame stopped the whole animation loop | The frame callbacks are isolated, so one failure is logged and the next frame still runs |
| Swapping models while a pinch-zoom was held applied the old zoom to the new model | Loading a model resets the gesture engine and skips one frame of gesture input |
| Unplugging the camera left a frozen frame that still counted as "ready" | A dead video track stops the stream, clears the gesture, and asks for a reload |
| Hiding the tab, then showing it, flung the model by the whole gap | A gap longer than 250 ms re-anchors the drag and clears the smoother |
| A background tab's slow frames tripped the quality watchdog | Frame-rate sampling pauses while the document is hidden, and the video resumes when the tab is shown |
| A resize that reported 0×0, or a lost WebGL context, stuck the view | Resize retries once on the next frame, and a lost context is asked to restore |
| A model with no meshes | Already rejected; still rejected, and the previous model stays |
| Files over 80 MB, or meshes over 2,000,000 vertices | Rejected before they are drawn, and anything already parsed is disposed |
| Hands entering and leaving quickly could count a ghost pinch as a second hand | A carried pinch is dropped when a live hand of the same handedness is already present |
| Shared hologram geometry and the point-cloud glow texture were disposed twice | Disposal skips geometry and textures marked as shared |
| An exploded model was disposed without putting its parts back | The explode cache is restored, then dropped, when the model changes |

`allowsHorizontalRotate` was exported and never called; it is gone. No source file was unused. `npm test` runs **226 checks**, all passing, including the earlier phase checks and two new ones for the stall and the hand that leaves and returns.

### Manual test checklist (Phase 10)

1. Load `knot.glb`, pinch-zoom, and drop `torus.stl` while still pinching: the new model appears at its own scale, not mid-zoom from the knot.
2. Unplug the camera (or stop the track in the site settings): the preview says the camera disconnected, and dragging with the mouse still orbits.
3. Pinch, switch to another tab for a second, come back with your hand elsewhere: the model does not spin across the gap.
4. Resize the window, including down to a phone width and back: the hologram keeps its framing and does not stretch.
5. Switch modes 1–4 quickly, then Slice and Explode: each mode starts from a reset cut or separation, and the same mode pressed twice does nothing extra.
6. Drop `broken.glb`, then a file you know is empty or enormous: a message names the failure and the current model stays.
7. Wave one hand in and out of frame: the status flips between a hand and no hand, and a half-second gap does not throw the model.

**Phase 10 complete.**
