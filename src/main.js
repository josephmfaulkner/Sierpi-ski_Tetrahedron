import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildInfiniteZoomGeometry, tetrahedronVertices } from './sierpinski.js';

const container = document.getElementById('app');
const info = document.getElementById('info');
const colorPicker = document.getElementById('color');
const bgTopPicker = document.getElementById('bg-top');
const bgBottomPicker = document.getElementById('bg-bottom');
const animateToggle = document.getElementById('animate');
const speedSlider = document.getElementById('speed');
const speedValue = document.getElementById('speed-value');
const sideDepthSlider = document.getElementById('side-depth');
const sideDepthValue = document.getElementById('side-depth-value');

const DEFAULT_COLOR = '#c2c2c2';
const DEFAULT_BG_TOP = '#6496c3';
const DEFAULT_BG_BOTTOM = '#05060a';

// Seconds for the automatic animation to double the zoom / complete one
// full rotation, at speed = 1x.
const AUTO_ZOOM_DOUBLE_SECONDS = 6;
const AUTO_ROTATE_PERIOD_SECONDS = 52;
const Z_AXIS = new THREE.Vector3(0, 0, 1);

// The 3 non-apex/non-ancestor corners never subdivide past this — they're
// the "one resolution" context part of the pyramid, away from whatever the
// current zoom focus is. User-adjustable via the Detail slider.
let sideDepth = parseInt(sideDepthSlider.value, 10);
// How deep the apex-chasing spine sits at the default, un-zoomed view.
const BASE_SPINE_DEPTH = 4;
// Soft ceilings on how far either direction can go — geometry stays cheap
// (linear in these) well past this, so these exist mainly to keep a single
// frame's rebuild bounded, not because precision runs out.
const MAX_SPINE_DEPTH = 30;
const MAX_OUT_LEVEL = 30;

// The fixed point the whole app pivots around: the apex of the tetrahedron.
// It never changes (it's a fixed point of the fractal's construction) and
// is used both as the static camera's look-at point and as the pyramid's
// rotation/scale pivot.
const [F] = tetrahedronVertices();

const scene = new THREE.Scene();

// The background is a small vertical-gradient canvas used as a screen-space
// backdrop texture, so it always renders top-to-bottom regardless of camera
// orientation.
const bgCanvas = document.createElement('canvas');
bgCanvas.width = 1;
bgCanvas.height = 256;
const bgCtx = bgCanvas.getContext('2d');
const bgTexture = new THREE.CanvasTexture(bgCanvas);
bgTexture.colorSpace = THREE.SRGBColorSpace;
scene.background = bgTexture;

function setBackground(topColor, bottomColor) {
  const gradient = bgCtx.createLinearGradient(0, 0, 0, bgCanvas.height);
  gradient.addColorStop(0, topColor);
  gradient.addColorStop(1, bottomColor);
  bgCtx.fillStyle = gradient;
  bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
  bgTexture.needsUpdate = true;
}

const INITIAL_CAMERA_POSITION = new THREE.Vector3(3.2, -3.2, 3);

// The camera that actually renders the scene. It is completely static —
// set up once, never moved again — so the apex it looks at is always
// exactly centered on screen no matter what the user does.
const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.01,
  100
);
camera.up.set(0, 0, 1);
camera.position.copy(INITIAL_CAMERA_POSITION);
camera.lookAt(F);

const CAMERA_TO_F_DISTANCE = camera.position.distanceTo(F);

// How far (in world units, along Z) a screen point needs to project from F
// to land at a given normalized screen height (-1 bottom, +1 top), found
// by bisection since perspective projection isn't linear in the offset.
// Only the Z coordinate ever varies here — X and Y stay locked to F's.
function screenYAtZOffset(zOffset) {
  return new THREE.Vector3(F.x, F.y, F.z + zOffset).project(camera).y;
}
// Scans outward from 0 in both directions to find the nearest point where
// screenYAtZOffset crosses targetY, then bisects — direction-agnostic, so
// it doesn't depend on assuming which way Z maps to screen-up for this
// particular camera angle.
function findZOffsetForScreenY(targetY) {
  const f = (z) => screenYAtZOffset(z) - targetY;
  const step = 0.02;
  const maxSteps = Math.ceil((CAMERA_TO_F_DISTANCE * 3) / step);
  for (const dir of [1, -1]) {
    let prevZ = 0;
    let prevVal = f(0);
    for (let i = 1; i <= maxSteps; i++) {
      const z = dir * i * step;
      const val = f(z);
      if (prevVal < 0 !== val < 0) {
        let lo = prevZ;
        let hi = z;
        for (let j = 0; j < 50; j++) {
          const mid = (lo + hi) / 2;
          if (f(mid) < 0 === prevVal < 0) lo = mid;
          else hi = mid;
        }
        return (lo + hi) / 2;
      }
      prevZ = z;
      prevVal = val;
    }
  }
  console.warn('findZOffsetForScreenY: no crossing found, defaulting to 0');
  return 0;
}
// A little short of the very top edge (+1), so the tip isn't clipped.
const DEFAULT_Z_OFFSET = findZOffsetForScreenY(0.85);

// A second, never-rendered camera exists purely to receive mouse/wheel
// input via OrbitControls, exactly as the real camera used to. Its orbit
// state (orientation + distance from F) is converted every frame into a
// rotation + uniform scale applied to the pyramid instead of the camera —
// see updatePivotFromInput() below. Letting OrbitControls drive this proxy
// (rather than reimplementing drag/zoom by hand) keeps the damping, inertia
// and zoom limits identical to before.
const inputCamera = new THREE.PerspectiveCamera(55, 1, 0.01, 100);
inputCamera.up.set(0, 0, 1);
inputCamera.position.copy(INITIAL_CAMERA_POSITION);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

// Orbit around the apex only: no panning, so the target — and therefore
// the framing — can never move away from the top of the pyramid no matter
// how the user rotates or zooms.
const controls = new OrbitControls(inputCamera, renderer.domElement);
controls.target.copy(F);
controls.enablePan = false;
controls.enableDamping = true;
controls.dampingFactor = 0.08;
// These only need to be wide enough that updatePivotFromInput's own
// distance-renormalization (below) never actually pushes distance out this
// far in ordinary use — they're a safety net, not the real zoom limit.
controls.minDistance = 1e-9;
controls.maxDistance = 1e11;
controls.update();

const INITIAL_DISTANCE = inputCamera.position.distanceTo(F);

// Start already zoomed in, rather than at 1x — moves inputCamera to
// INITIAL_DISTANCE / DEFAULT_ZOOM along the same ray, which is exactly
// what a zoom of DEFAULT_ZOOM means relative to that reference distance.
const DEFAULT_ZOOM = 10;
inputCamera.position.sub(F).multiplyScalar(1 / DEFAULT_ZOOM).add(F);

// Single directional light, as requested.
const light = new THREE.DirectionalLight(0xffffff, 3.2);
light.position.set(6, 5, 4);
scene.add(light);

// Three point lights add colored fill/rim light: neutral white, a warm
// off-white, and a cool off-white, each from a different side.
const pointLightWhite = new THREE.PointLight(0xffffff, 25);
pointLightWhite.position.set(-3.5, 3, 2.5);
scene.add(pointLightWhite);

const pointLightWarm = new THREE.PointLight(0xffd9a6, 25);
pointLightWarm.position.set(3.5, 2, -2);
scene.add(pointLightWarm);

const pointLightCool = new THREE.PointLight(0xb7d4ff, 25);
pointLightCool.position.set(0, -4, 1.5);
scene.add(pointLightCool);

const material = new THREE.MeshStandardMaterial({
  color: DEFAULT_COLOR,
  flatShading: true,
  roughness: 0.5,
  metalness: 0.1,
  side: THREE.DoubleSide,
});

// The pyramid rotates and scales about this pivot, which sits at F plus a
// vertical (Z-only) offset the user can adjust — see the right-click-drag
// handler below. The geometry itself is built in coordinates relative to
// the apex (apex at local origin — see sierpinski.js), so the mesh needs
// no offset of its own: any rotation/scale the pivot receives leaves local
// (0,0,0) — the apex — fixed at pivot.position, in world space, always.
const pivot = new THREE.Group();
scene.add(pivot);

let zOffset = DEFAULT_Z_OFFSET;
function applyPivotPosition() {
  pivot.position.set(F.x, F.y, F.z + zOffset);
}
applyPivotPosition();

// Right-click-drag moves the pyramid up/down along Z only — X and Y stay
// completely locked to F's, and rotation/zoom (driven separately by the
// left-drag/scroll-controlled inputCamera) are untouched. Since it's the
// pivot's position that's being dragged, and that position is exactly what
// stays screen-locked through zoom/rotation, this has a direct, consistent
// pixel-to-world relationship regardless of current zoom level.
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

let isDraggingZ = false;
let lastDragClientY = 0;

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 2) return;
  isDraggingZ = true;
  lastDragClientY = e.clientY;
  renderer.domElement.setPointerCapture(e.pointerId);
  e.preventDefault();
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (!isDraggingZ) return;
  const deltaY = e.clientY - lastDragClientY;
  lastDragClientY = e.clientY;
  const worldUnitsPerPixel =
    (2 * CAMERA_TO_F_DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / window.innerHeight;
  zOffset -= deltaY * worldUnitsPerPixel;
  applyPivotPosition();
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.button !== 2) return;
  isDraggingZ = false;
  renderer.domElement.releasePointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointercancel', () => {
  isDraggingZ = false;
});

let mesh = null;
let currentSpineDepth = -1;
let currentOutLevel = -1;

function setDetail(spineDepth, outLevel) {
  currentSpineDepth = spineDepth;
  currentOutLevel = outLevel;
  const { geometry, triangleCount } = buildInfiniteZoomGeometry(spineDepth, outLevel, sideDepth);

  if (mesh) {
    pivot.remove(mesh);
    mesh.geometry.dispose();
  }
  mesh = new THREE.Mesh(geometry, material);
  pivot.add(mesh);

  return triangleCount;
}

let lastTriangleCount = setDetail(BASE_SPINE_DEPTH + Math.ceil(Math.log2(DEFAULT_ZOOM)), 0);

// Converts the input camera's current orbit (its rotation around F and its
// distance from F) into an equivalent rotation + uniform scale of the
// pivot, such that rendering the transformed pyramid with the static real
// camera produces the exact same image as rendering the untransformed
// pyramid with the orbiting input camera would. (Perspective dolly-zoom by
// a factor and inverse-scaling the object about the look-at point are
// projectively equivalent; rotating the object by the camera's rotation
// relative to its own fixed orientation reproduces the same apparent spin.)
const rotationScratch = new THREE.Quaternion();

// Once zoom pushes spineDepth/outLevel past their cap, the geometry stops
// changing — so if `distance` itself just kept shrinking/growing from
// there, the view would eventually hit OrbitControls' own hard min/max
// and simply stop responding. Instead, `resetLevel` absorbs however many
// extra "octaves" of zoom have happened past the cap: every time the
// natural log2(zoom) would exceed the cap's span, distance is silently
// doubled (or halved, zooming out) — undoing that octave — and resetLevel
// tracks it instead. This is invisible because of the fractal's exact
// self-similarity: the capped geometry's own apex corner, magnified 2x,
// looks the same as the whole capped geometry unmagnified, so swapping
// back to "unmagnified" is unnoticeable. `distance` therefore never has
// to leave a bounded, comfortable range no matter how long the user keeps
// scrolling in one direction, while the numbers shown to the user (built
// from logZoom + resetLevel) keep growing/shrinking forever, genuinely
// without bound.
const SPINE_SPAN = MAX_SPINE_DEPTH - BASE_SPINE_DEPTH;
let resetLevel = 0;

let autoPlay = animateToggle.checked;
let speedMultiplier = parseFloat(speedSlider.value);
const autoOffset = new THREE.Vector3();

function updatePivotFromInput(dt) {
  // While animating, OrbitControls' own listeners are disabled so manual
  // drag/scroll input can't fight with the automatic motion; toggling
  // Animate off hands control straight back with no other state to sync,
  // since both paths ultimately just drive the same inputCamera.position.
  controls.enabled = !autoPlay;

  if (autoPlay) {
    autoOffset.copy(inputCamera.position).sub(F);
    autoOffset.applyAxisAngle(Z_AXIS, ((2 * Math.PI) / AUTO_ROTATE_PERIOD_SECONDS) * speedMultiplier * dt);
    autoOffset.multiplyScalar(Math.pow(0.5, (speedMultiplier * dt) / AUTO_ZOOM_DOUBLE_SECONDS));
    inputCamera.position.copy(F).add(autoOffset);
  }

  controls.update();

  rotationScratch.copy(camera.quaternion).multiply(inputCamera.quaternion.clone().invert());
  pivot.quaternion.copy(rotationScratch);

  let logZoom = Math.log2(INITIAL_DISTANCE / inputCamera.position.distanceTo(F));

  while (logZoom > SPINE_SPAN) {
    inputCamera.position.sub(F).multiplyScalar(2).add(F);
    resetLevel += 1;
    logZoom -= 1;
  }
  while (logZoom < -MAX_OUT_LEVEL) {
    inputCamera.position.sub(F).multiplyScalar(0.5).add(F);
    resetLevel -= 1;
    logZoom += 1;
  }

  const zoom = Math.pow(2, logZoom); // always safely bounded now
  pivot.scale.setScalar(zoom);

  // Each spine level doubles the apex corner's apparent size, so the depth
  // needed to keep its detail crisp at the current zoom is just log2(zoom)
  // past the base depth. Symmetrically, zooming out past the pyramid's own
  // boundary needs ancestor context revealed at the same rate in the other
  // direction — log2(1/zoom) out-levels. Only one of the two is ever
  // nonzero. The tiny epsilon absorbs floating-point noise from the damped
  // orbit math so zoom values that are "1.0" in every way that matters
  // don't occasionally round up past 0.
  const EPS = 1e-6;
  const requiredSpineDepth = THREE.MathUtils.clamp(
    BASE_SPINE_DEPTH + Math.ceil(Math.max(0, logZoom - EPS)),
    0,
    MAX_SPINE_DEPTH
  );
  const requiredOutLevel = THREE.MathUtils.clamp(
    Math.ceil(Math.max(0, -logZoom - EPS)),
    0,
    MAX_OUT_LEVEL
  );

  if (requiredSpineDepth !== currentSpineDepth || requiredOutLevel !== currentOutLevel) {
    lastTriangleCount = setDetail(requiredSpineDepth, requiredOutLevel);
  }

  // The true cumulative zoom/depth, for display only — unbounded, and
  // reflects every reset that's happened, unlike the deliberately-bounded
  // values above that actually drive rendering.
  const trueLogZoom = logZoom + resetLevel;
  const displaySpine = BASE_SPINE_DEPTH + Math.max(0, Math.ceil(trueLogZoom - EPS));
  const displayOut = Math.max(0, Math.ceil(-trueLogZoom - EPS));
  const trueZoom = Math.pow(2, trueLogZoom);
  const zoomLabel =
    Math.abs(trueLogZoom) > 16 ? trueZoom.toExponential(2) : trueZoom.toFixed(trueZoom < 10 ? 3 : 0);

  info.textContent = `spine ${displaySpine} · horizon ${displayOut} · zoom ×${zoomLabel} — ${lastTriangleCount.toLocaleString()} triangles`;
}

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  updatePivotFromInput(clock.getDelta());
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

animateToggle.addEventListener('change', () => {
  autoPlay = animateToggle.checked;
});

speedValue.textContent = `${speedMultiplier}`;
speedSlider.addEventListener('input', () => {
  speedMultiplier = parseFloat(speedSlider.value);
  speedValue.textContent = `${speedMultiplier}`;
});

sideDepthSlider.addEventListener('input', () => {
  sideDepth = parseInt(sideDepthSlider.value, 10);
  sideDepthValue.textContent = String(sideDepth);
  lastTriangleCount = setDetail(currentSpineDepth, currentOutLevel);
});

colorPicker.value = DEFAULT_COLOR;
colorPicker.addEventListener('input', () => {
  material.color.set(colorPicker.value);
});

bgTopPicker.value = DEFAULT_BG_TOP;
bgBottomPicker.value = DEFAULT_BG_BOTTOM;
setBackground(DEFAULT_BG_TOP, DEFAULT_BG_BOTTOM);

function updateBackgroundFromControls() {
  setBackground(bgTopPicker.value, bgBottomPicker.value);
}
bgTopPicker.addEventListener('input', updateBackgroundFromControls);
bgBottomPicker.addEventListener('input', updateBackgroundFromControls);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
