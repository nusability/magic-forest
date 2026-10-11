import * as THREE from 'three';

// The base shapes every plant part is an instance of. Near parts keep the hand-tuned shapes;
// far parts are the cheapest shapes that still read at a distance.

const CURVE_SEGMENTS = 6;
const LEAF_CUP = 0.9;
const PETAL_CUP = 1.2;
const BARK_TAPER = 0.75; // a segment's top radius as a share of its bottom
const NEAR_BARK_SIDES = 6;
const FAR_BARK_SIDES = 4; // trunks seen from afar still look round with four lit sides
// A core is a few pixels of glow under the bloom pass; twenty faces read as round there, at a
// quarter of the triangles of the next subdivision.
const CORE_DETAIL = 0;

function cuppedShape(shape: THREE.Shape, cup: number): THREE.BufferGeometry {
  const geometry = new THREE.ShapeGeometry(shape, CURVE_SEGMENTS);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, -cup * pos.getX(i) ** 2);
  geometry.computeVertexNormals();
  return geometry;
}

export function leafGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(0.38, 0.4, 0, 1);
  s.quadraticCurveTo(-0.38, 0.4, 0, 0);
  return cuppedShape(s, LEAF_CUP);
}

export function petalGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.5, 0.3, 0.42, 0.95, 0, 1);
  s.bezierCurveTo(-0.42, 0.95, -0.5, 0.3, 0, 0);
  return cuppedShape(s, PETAL_CUP);
}

/** A unit branch segment from y = 0 to y = 1, scaled per instance to its radius and length. */
export function barkGeometry(far: boolean): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(BARK_TAPER, 1, 1, far ? FAR_BARK_SIDES : NEAR_BARK_SIDES, 1, true).translate(0, 0.5, 0);
}

export function coreGeometry(): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(1, CORE_DETAIL);
}

/** A camera-facing square from -1 to 1, the canvas a far leaf clump is painted on. */
export function clumpGeometry(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(2, 2);
}
