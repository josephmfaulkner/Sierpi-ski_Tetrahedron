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
// every leaf tetrahedron as flat vertex triples. Used uniformly by itself,
// and as the fixed-resolution building block for the 3 non-apex corners in
// subdivideAdaptive below.
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

  subdivide(v0, m01, m02, m03, depth - 1, out);
  subdivide(m01, v1, m12, m13, depth - 1, out);
  subdivide(m02, m12, v2, m23, depth - 1, out);
  subdivide(m03, m13, m23, v3, depth - 1, out);
}

// Asymmetric version of the same subdivision: the 3 corners away from the
// apex (v1, v2, v3's corners) are rendered once, at a fixed `sideDepth` —
// they're far from the zoom focus, so recursing further into them would
// just spend triangles on detail nobody will get close enough to see. Only
// the apex corner (v0's corner, itself an exact half-scale copy of the
// whole tetrahedron) keeps recursing, one level per step, down `spineDepth`
// times. Because 3 of the 4 branches stop immediately at every step,
// triangle count grows linearly in spineDepth instead of exponentially,
// which is what makes it cheap to chase the apex arbitrarily deep as the
// pyramid is zoomed into.
function subdivideAdaptive(v0, v1, v2, v3, spineDepth, sideDepth, out) {
  const m01 = mid(v0, v1);
  const m02 = mid(v0, v2);
  const m03 = mid(v0, v3);
  const m12 = mid(v1, v2);
  const m13 = mid(v1, v3);
  const m23 = mid(v2, v3);

  subdivide(m01, v1, m12, m13, sideDepth, out);
  subdivide(m02, m12, v2, m23, sideDepth, out);
  subdivide(m03, m13, m23, v3, sideDepth, out);

  if (spineDepth <= 0) {
    subdivide(v0, m01, m02, m03, sideDepth, out);
    return;
  }

  subdivideAdaptive(v0, m01, m02, m03, spineDepth - 1, sideDepth, out);
}

function verticesToGeometry(verts, apex) {
  const positions = new Float32Array(verts.length * 3);
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i];
    positions[i * 3] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();

  return {
    geometry,
    triangleCount: verts.length / 3,
    apex: apex.clone(),
  };
}

// Builds a Sierpiński tetrahedron with detail concentrated toward the apex:
// `spineDepth` controls how many times the apex corner recurses (unbounded
// zoom-worthy detail near the tip), while `sideDepth` is the fixed depth
// every other corner stops at, at every step along the way.
export function buildAdaptiveSierpinskiGeometry(spineDepth, sideDepth, edge = 2) {
  const [v0, v1, v2, v3] = tetrahedronVertices(edge);
  const verts = [];
  subdivideAdaptive(v0, v1, v2, v3, spineDepth, sideDepth, verts);
  return verticesToGeometry(verts, v0);
}
