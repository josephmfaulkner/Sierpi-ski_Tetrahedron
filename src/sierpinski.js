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

function verticesToGeometry(verts) {
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

  return { geometry, triangleCount: verts.length / 3 };
}

// Builds a Sierpiński tetrahedron with detail concentrated toward the apex
// AND context extending outward from its base, entirely in coordinates
// relative to the apex (the apex itself sits at local (0,0,0)). The caller
// is expected to place the apex at its real world position via a transform
// (translation), never by baking that offset into vertex data — that's
// what keeps this precise at extreme zoom. Storing "large constant + tiny
// offset" directly in a Float32Array silently rounds the tiny offset away
// once it drops below roughly the constant's own magnitude times 1.2e-7
// (float32's relative precision); a small number on its own has no such
// floor, however deep the recursion goes.
//
// `spineDepth` controls how many times the apex corner recurses inward
// (detail toward the tip); `outLevel` controls how many implied ancestor
// tetrahedra — of which this one is exactly the apex corner, one nested
// inside the next — have their other 3 corners revealed outward (context
// as you zoom out past this pyramid's own boundary). `sideDepth` is the
// fixed resolution every one of those side/ancestor corners stops at, in
// both directions. All three keep triangle count linear in depth, so both
// directions can go arbitrarily deep cheaply.
export function buildInfiniteZoomGeometry(spineDepth, outLevel, sideDepth, edge = 2) {
  const [worldApex, v1, v2, v3] = tetrahedronVertices(edge);
  const apex = new THREE.Vector3(0, 0, 0);
  let local1 = v1.clone().sub(worldApex);
  let local2 = v2.clone().sub(worldApex);
  let local3 = v3.clone().sub(worldApex);

  const verts = [];
  subdivideAdaptive(apex, local1, local2, local3, spineDepth, sideDepth, verts);

  // Walk outward: at each step, (apex, local1, local2, local3) is exactly
  // the apex corner of a tetrahedron twice its size (since midpoint(apex,
  // 2*local_i) == local_i). Reveal that parent's other 3 corners, then
  // adopt the parent's vertices as the new "current" ones and repeat.
  for (let m = 0; m < outLevel; m++) {
    const p1 = local1.clone().multiplyScalar(2);
    const p2 = local2.clone().multiplyScalar(2);
    const p3 = local3.clone().multiplyScalar(2);
    const m12 = mid(p1, p2);
    const m13 = mid(p1, p3);
    const m23 = mid(p2, p3);

    subdivide(local1, p1, m12, m13, sideDepth, verts);
    subdivide(local2, m12, p2, m23, sideDepth, verts);
    subdivide(local3, m13, m23, p3, sideDepth, verts);

    local1 = p1;
    local2 = p2;
    local3 = p3;
  }

  return { ...verticesToGeometry(verts), apex: worldApex.clone() };
}
