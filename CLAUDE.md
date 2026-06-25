# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based 3D viewer for a gaussian-splat scan of a garage, built directly on the
PlayCanvas engine (no editor, no framework). It renders the splat, places a glowing
"location orb" on the floor, and can drive that orb from a live HLK/LD2450 mmWave radar
sensor so a person walking the real garage shows up as the orb in the scan.

## Commands

```bash
npm install
npm run dev          # vite (port 5173); dev:vite-only is a synonym
npm run build        # vite production build -> dist/
npm run preview      # serve the built dist/
```

There is no test suite and no eslint config checked in (despite an `npx eslint`
permission). "Verifying" a change means running `npm run dev` and exercising it in the
browser; `window.__viewer` exposes `{ app, splat, camera, controls, orb, field, sources,
autoCam, minimap, center, halfExtents, params }` for console inspection (`orb` is the
primary orb; `field` is the full `OrbField`).

The sensor is a self-contained ESP device (`firmware/garage-radar/`) the viewer connects
to directly over WebSocket (`ws://garage-radar.local:81`, in `defaults.json`). There is no
bridge or `.env` to configure.

## Architecture

Everything is wired together in `src/main.js`. The flow: load the two assets, derive
room bounds, build the scene graph, then drive everything from a single `app.on('update')`
loop. `buildScene()` is a high-level orchestrator that delegates to module-level helpers —
`deriveRoomBounds(collisionMesh)` (measures the collision mesh, returns its AABB or null),
`generateDefaultAnchors(center, halfExtents)` (returns the four quadrant anchors), and
`wireHotkeys(...)` (binds the keyboard shortcuts). The major subsystems are independent
classes constructed once in `buildScene()`:

- **`Orb`** (`orb.js`) — emissive sphere that writes depth. Holds a `target` and eases its
  actual position toward it each frame (exponential smoothing). `teleport()` snaps, `setTarget()` eases.
- **`OrbField`** (`orb-field.js`) — owns up to three `Orb`s (one per tracked person) and is
  what `main.js` actually wires to. `primary()` (always orb 0) feeds the single-target
  subsystems (follow camera, frame-orb, glow-facing, session save); `active()` feeds the glow
  shader, minimap and overlay. Orb i tracks LD2450 slot i (index == identity, no swapping).
- **`OrbSources`** (`orb-sources.js`) — decides where the orbs' targets should be. Three modes
  selected by `params.source.mode`: `click` (double-click floor + arrow keys), `demo`
  (lissajous wander), `sensor` (WebSocket JSON `{targets:[{x,y,speed}, …]}` in mm, up to three).
  Click/demo drive only the primary orb. `sensorToWorld()` applies
  the origin/rotation/scale/flip calibration that maps sensor space to world space.
- **`SplatFX`** (`splat-effects.js`) — the visual heart. Installs a custom `gsplatModifyVS`
  shader chunk (both GLSL and WGSL — keep them in sync) on the shared gsplat material. It
  does the orb glow (point-light falloff, surface-normal-aware via the gaussian's flattest
  axis) accumulated for up to three orbs (`uOrbPos0..2` + `uOrbCount`), and the
  cutaway/dollhouse fade. Uniforms are pushed via `setParams({ orbs: [[x,y,z], …], … })`.
- **`WaypointCamera`** (`waypoint-camera.js`) — the "anchor follow" / cinematic camera
  (toggled by `params.camera.orbitOrb`, key `O`). Floor is partitioned into zones, each with
  a high corner "anchor eye." The orb is projected onto a control loop (zone centers) to get a
  rail parameter, and the camera rides the co-indexed rail loop (anchor eyes). It drives the
  camera entity directly and suspends the manual `CameraControls` while active.
- **`CameraControls`** (`camera-controls.js`) — manual desktop fly/orbit/pan camera, keyboard +
  mouse only. Adapted from the PlayCanvas multi-platform camera example, then stripped to the
  desktop kiosk: no mobile/touch/gamepad/XR input paths. `main.js` only sets `moveSpeed`,
  `moveFastSpeed`, `rotateSpeed`, `zoomRange`; the controllers keep their own damping/range
  defaults.
- **`SensorMinimap`** (`sensor-minimap.js`) — bottom-left radar plot of the live mmWave stream,
  visible only in sensor mode.
- **Settings panel** (`settings.js` + `panel-controls.js` + `panel.css`) — a hand-rolled,
  dependency-free control toolkit (replaced Tweakpane). Controls write straight through to the
  shared `params` object and fire `onChange` hooks defined in `main.js`.

### Critical conventions

- **Two coordinate flips matter.** The splat is rendered with `setLocalEulerAngles(180, 0, 0)`
  because raw 3DGS data is y-down. Room bounds come from the **collision mesh** (`garagecollisionmesh.glb`),
  *not* the splat AABB — the splat AABB is bloated by floater outliers. The collision mesh is
  measured then immediately `destroy()`ed; it is never rendered.

- **The splat shader runs in world space.** In PlayCanvas unified gsplat mode, the
  `gsplatModifyVS` chunk runs in the copy-to-workbuffer pass where splat centers are already in
  world space — so orb/camera positions are passed as plain world coordinates.

- **Setting a gsplat parameter is expensive.** It marks the placement render-dirty (re-copies the
  workbuffer and resorts). `SplatFX.setParams()` takes a named-field object (`orbPos`, `orbColor`,
  `cutCamPos`, `viewPos`, etc.) and short-circuits when nothing changed — it flattens those fields
  into a change-key and compares against the last. `main.js` quantizes positions (`round(v, 0.01)`
  etc.) before passing them so tiny jitter doesn't trigger a resort every frame. Preserve both the
  named contract and the quantization when touching the update loop.

- **Params and persistence.** `defaults.json` holds shipped defaults (a `view` and a `params`
  tree). `params.js` exports the single live `params` object (a clone of the defaults).
  `settings-store.js` deep-merges a localStorage session over the defaults on startup and writes
  it back on save (key `garage-viewer-settings`). The whole app reads and mutates that one shared
  `params` object — there is no reactive layer, so changes take effect because the update loop
  reads the fields every frame, and panel `onChange` hooks call back into `main.js` to apply
  things that aren't read live (e.g. camera FOV, render scale).

- **Anchors auto-generate.** If `params.camera.anchors` is empty at load, `generateDefaultAnchors()`
  derives four quadrant zones with diagonally-opposite high corner eyes from the runtime room bounds.
  Captured anchors (keys `1`–`4`, persisted via the session store) override these.

### The sensor path

The radar runs custom ESP32 firmware (`firmware/garage-radar/`, Arduino/PlatformIO) that reads
the **raw 30-byte LD2450 frame** (`AA FF 03 00` + 3×8-byte targets + `55 CC`) directly off UART,
decodes each target's signed-magnitude X/Y/speed, and **serves all active targets as one JSON
packet per frame over its own WebSocket** (`ws://garage-radar.local:81`, port 81) at the sensor's
native ~10 Hz: `{"targets":[{"x":<mm>,"y":<mm>,"speed":<cm/s>}, …]}`. The viewer's sensor mode
(`orb-sources.js`) connects straight to it — no SSE, no Node bridge.

This replaced an ESPHome setup whose `web_server` only spoke SSE (which deduped identical states),
exposed just target_1's X/Y as two separate sensors, and needed a Node bridge to re-pair them.
The old config is kept (superseded) at `esphome/garage-radar.yaml` for flashing history only.

Because the ESP serves insecure `ws://`, the viewer page must be loaded over **http** (Vite
dev / LAN) — an `https` page can't open the socket (mixed content).
