import * as THREE from 'three';

// A regular tetrahedron with vertex 0 ("apex") on the +Z axis and the other
// three vertices forming its base below. Z is the tetrahedron's natural
// 3-fold rotational symmetry axis (apex <-> base centroid), which is what
// lets the camera orbit around world Z while staring at the apex.
export function tetrahedronVertices(edge = 2) {
  const h = edge * Math.sqrt(2 / 3); // apex-to-base height
  const r = edge / Math.sqrt(3); // base circumradius
  const zApex = (3 * h) / 4;
  const zBase = -h / 4;

  const apex = new THREE.Vector3(0, 0, zApex);
  const base = [0, 1, 2].map((i) => {
    const angle = (Math.PI * 2 * i) / 3 + Math.PI / 2;
    return new THREE.Vector3(r * Math.cos(angle), r * Math.sin(angle), zBase);
  });

  return [apex, ...base]; // v0 is always the apex / zoom target
}

function mid(a, b) {
  return new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
}

// Recursively keep the 4 corner tetrahedra (half scale) and discard the
// central octahedron, down to `depth`. Emits the 4 triangular faces of
// every leaf tetrahedron as flat vertex triples.
function subdivide(v0, v1, v2, v3, depth, out) {
  if (depth === 0) {
    out.push(v0, v1, v2, v0, v1, v3, v0, v2, v3, v1, v2, v3);
    return;
  }

  const m01 = mid(v0, v1);
  const m02 = mid(v0, v2);
  const m03 = mid(v0, v3);
  const m12 = mid(v1, v2);
  const m13 = mid(v1, v3);
  const m23 = mid(v2, v3);

  // Corner 0 keeps v0 (the apex) fixed — this is the branch the camera
  // dives into forever, and by construction it is itself a half-scale
  // Sierpiński tetrahedron anchored at the exact same apex point.
  subdivide(v0, m01, m02, m03, depth - 1, out);
  subdivide(m01, v1, m12, m13, depth - 1, out);
  subdivide(m02, m12, v2, m23, depth - 1, out);
  subdivide(m03, m13, m23, v3, depth - 1, out);
}

const _colorTop = new THREE.Color(0x8ab4ff);
const _colorBottom = new THREE.Color(0xff5da2);
const _tmpColor = new THREE.Color();

export function buildSierpinskiGeometry(depth, edge = 2) {
  const [v0, v1, v2, v3] = tetrahedronVertices(edge);
  const verts = [];
  subdivide(v0, v1, v2, v3, depth, verts);

  const positions = new Float32Array(verts.length * 3);
  const colors = new Float32Array(verts.length * 3);

  const zApex = v0.z;
  const zBottom = Math.min(v1.z, v2.z, v3.z);
  const zRange = zApex - zBottom;

  for (let i = 0; i < verts.length; i++) {
    const v = verts[i];
    positions[i * 3] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;

    const t = THREE.MathUtils.clamp((zApex - v.z) / zRange, 0, 1);
    _tmpColor.copy(_colorTop).lerp(_colorBottom, t);
    colors[i * 3] = _tmpColor.r;
    colors[i * 3 + 1] = _tmpColor.g;
    colors[i * 3 + 2] = _tmpColor.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  return {
    geometry,
    triangleCount: verts.length / 3,
    apex: v0.clone(),
  };
}
