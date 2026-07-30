import * as THREE from 'three';
import { buildSierpinskiGeometry } from './sierpinski.js';

const container = document.getElementById('app');
const info = document.getElementById('info');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
scene.fog = new THREE.FogExp2(0x05060a, 0.045);

const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.05,
  60
);
camera.up.set(0, 0, 1);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0x404060, 1.3));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(3, 2, 4);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x88aaff, 1.1);
rimLight.position.set(-4, -2, -3);
scene.add(rimLight);

const material = new THREE.MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 0.45,
  metalness: 0.12,
  side: THREE.DoubleSide,
});

// --- Level of detail -------------------------------------------------------
//
// The Sierpiński tetrahedron is exactly self-similar: the corner touching
// the apex is itself a half-scale copy of the whole fractal, anchored at
// the very same apex point. That lets us fake an infinite zoom cheaply:
// the camera dives from distance D0 down to D0/2 (at which point the
// apex-corner sub-tetrahedron alone fills the frame, pixel-for-pixel where
// the whole tree used to be), then the camera distance snaps back out to
// D0 at the exact instant we swap in a freshly built tree. Because of the
// self-similarity, that swap is visually seamless — no re-scaling or
// re-centering of the mesh is needed, only a fresh geometry each cycle.
//
// Recursion depth ramps up over the first few cycles (cheap tree while
// still zoomed "out", more triangles only once we're deep enough for it
// to matter) and then holds at a cap, so geometry stops being rebuilt
// entirely and the loop becomes essentially free to sustain forever.
const BASE_DEPTH = 2;
const MAX_DEPTH = 7;

let mesh = null;
let apex = new THREE.Vector3();
let currentDepth = -1;

function setDepth(depth) {
  if (depth === currentDepth) return;
  currentDepth = depth;

  const { geometry, triangleCount, apex: newApex } = buildSierpinskiGeometry(depth);
  apex = newApex;

  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
  }
  mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  info.textContent = `recursion depth ${depth} / ${MAX_DEPTH} — ${triangleCount.toLocaleString()} triangles`;
}

setDepth(BASE_DEPTH);

// --- Camera path -------------------------------------------------------
const BASE_DISTANCE = 5;
const CYCLE_SECONDS = 7; // seconds to zoom from D0 to D0/2 before looping
const ROTATION_PERIOD = 55; // seconds per full revolution around Z
const POLAR_ANGLE = THREE.MathUtils.degToRad(62); // tilt off the +Z axis

const clock = new THREE.Clock();
let elapsed = 0;
const dir = new THREE.Vector3();

function animate() {
  const dt = clock.getDelta();
  elapsed += dt;

  const zoomPhase = elapsed / CYCLE_SECONDS;
  const level = Math.floor(zoomPhase);
  const localPhase = zoomPhase - level;

  setDepth(Math.min(MAX_DEPTH, BASE_DEPTH + level));

  // Exponential dive within the cycle: 1x -> 0.5x, then the cycle rolls
  // over and (thanks to the fresh self-similar tree above) looks identical
  // to where we started, repeating forever.
  const distance = BASE_DISTANCE * Math.pow(2, -localPhase);
  const theta = (elapsed / ROTATION_PERIOD) * Math.PI * 2;

  dir.set(
    Math.sin(POLAR_ANGLE) * Math.cos(theta),
    Math.sin(POLAR_ANGLE) * Math.sin(theta),
    Math.cos(POLAR_ANGLE)
  );

  camera.position.copy(apex).addScaledVector(dir, distance);
  camera.lookAt(apex);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
