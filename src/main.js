import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildAdaptiveSierpinskiGeometry, tetrahedronVertices } from './sierpinski.js';

const container = document.getElementById('app');
const info = document.getElementById('info');
const colorPicker = document.getElementById('color');
const bgTopPicker = document.getElementById('bg-top');
const bgBottomPicker = document.getElementById('bg-bottom');

const DEFAULT_COLOR = '#3366ff';
const DEFAULT_BG_TOP = '#1a2036';
const DEFAULT_BG_BOTTOM = '#05060a';

// The 3 non-apex corners never subdivide past this — they're the "one
// resolution" part of the pyramid, far from the zoom focus.
const SIDE_DEPTH = 3;
// How deep the apex-chasing spine sits at the default, un-zoomed view.
const BASE_SPINE_DEPTH = 4;
// Hard ceiling so recursion (and float32 vertex precision, which runs out
// around here regardless) can't run away at extreme zoom.
const MAX_SPINE_DEPTH = 26;

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
// Deep enough that the adaptive spine (below) has real room to keep
// chasing the apex — this is what "infinite" zoom is bounded by now,
// rather than a shallow, fixed dolly limit.
controls.minDistance = 1e-7;
controls.maxDistance = 150;
controls.update();

const INITIAL_DISTANCE = inputCamera.position.distanceTo(F);

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

// The pyramid rotates and scales about this pivot, which sits exactly at F.
// The mesh itself is offset by -F so its apex vertex lands precisely on the
// pivot's local origin — meaning any rotation/scale the pivot receives
// leaves that one vertex fixed at F, in world space, always.
const pivot = new THREE.Group();
pivot.position.copy(F);
scene.add(pivot);

let mesh = null;
let currentSpineDepth = -1;

function setSpineDepth(spineDepth) {
  currentSpineDepth = spineDepth;
  const { geometry, triangleCount } = buildAdaptiveSierpinskiGeometry(spineDepth, SIDE_DEPTH);

  if (mesh) {
    pivot.remove(mesh);
    mesh.geometry.dispose();
  }
  mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(F).negate();
  pivot.add(mesh);

  return triangleCount;
}

let lastTriangleCount = setSpineDepth(BASE_SPINE_DEPTH);

// Converts the input camera's current orbit (its rotation around F and its
// distance from F) into an equivalent rotation + uniform scale of the
// pivot, such that rendering the transformed pyramid with the static real
// camera produces the exact same image as rendering the untransformed
// pyramid with the orbiting input camera would. (Perspective dolly-zoom by
// a factor and inverse-scaling the object about the look-at point are
// projectively equivalent; rotating the object by the camera's rotation
// relative to its own fixed orientation reproduces the same apparent spin.)
const rotationScratch = new THREE.Quaternion();

function updatePivotFromInput() {
  controls.update();

  rotationScratch.copy(camera.quaternion).multiply(inputCamera.quaternion.clone().invert());
  pivot.quaternion.copy(rotationScratch);

  const distance = inputCamera.position.distanceTo(F);
  const zoom = INITIAL_DISTANCE / distance;
  pivot.scale.setScalar(zoom);

  // Each spine level doubles the apex corner's apparent size, so the depth
  // needed to keep its detail crisp at the current zoom is just log2(zoom)
  // past the base depth — ceil() alone keeps it a fraction of a level
  // ahead, which is enough for the rebuild (synchronous, same frame) to
  // never lag behind what's on screen.
  // The tiny epsilon absorbs floating-point noise from the damped orbit
  // math so zoom values that are "1.0" in every way that matters don't
  // occasionally round up to the next depth level.
  const requiredDepth = THREE.MathUtils.clamp(
    BASE_SPINE_DEPTH + Math.ceil(Math.log2(zoom) - 1e-6),
    0,
    MAX_SPINE_DEPTH
  );

  if (requiredDepth !== currentSpineDepth) {
    lastTriangleCount = setSpineDepth(requiredDepth);
  }

  info.textContent = `spine depth ${currentSpineDepth} · zoom ×${zoom.toFixed(zoom < 10 ? 2 : 0)} — ${lastTriangleCount.toLocaleString()} triangles`;
}

function animate() {
  requestAnimationFrame(animate);
  updatePivotFromInput();
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

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
