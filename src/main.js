import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildSierpinskiGeometry } from './sierpinski.js';

const container = document.getElementById('app');
const info = document.getElementById('info');
const depthSlider = document.getElementById('depth');
const depthValue = document.getElementById('depth-value');
const colorPicker = document.getElementById('color');
const bgTopPicker = document.getElementById('bg-top');
const bgBottomPicker = document.getElementById('bg-bottom');

const DEFAULT_COLOR = '#3366ff';
const DEFAULT_BG_TOP = '#1a2036';
const DEFAULT_BG_BOTTOM = '#05060a';
const MAX_DEPTH = 10;

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

const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.01,
  100
);
// The tetrahedron's apex sits on +Z, so Z is treated as "up" — this keeps
// OrbitControls' rotation feeling natural relative to the pyramid.
camera.up.set(0, 0, 1);
camera.position.set(3.2, -3.2, 3);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

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

let mesh = null;
let apex = new THREE.Vector3();

function setDepth(depth) {
  const { geometry, triangleCount, apex: newApex } = buildSierpinskiGeometry(depth);
  apex = newApex;

  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
  }
  mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  // The apex is a fixed point of the construction (same for every depth),
  // but re-assert it so the orbit target never drifts.
  controls.target.copy(apex);

  info.textContent = `depth ${depth} — ${triangleCount.toLocaleString()} triangles`;
}

// Orbit around the apex only: no panning, so the target — and therefore
// the framing — can never move away from the top of the pyramid no matter
// how the user rotates or zooms.
const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.03;
controls.maxDistance = 150;

setDepth(parseInt(depthSlider.value, 10));

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

depthSlider.max = String(MAX_DEPTH);
depthSlider.addEventListener('input', () => {
  const depth = parseInt(depthSlider.value, 10);
  depthValue.textContent = String(depth);
  setDepth(depth);
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
