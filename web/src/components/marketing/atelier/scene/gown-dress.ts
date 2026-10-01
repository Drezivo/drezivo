import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  TorusGeometry,
  Vector3,
} from 'three';

import { FORM_DEPTH, torsoRadiusAt, WAIST_Y } from './form-profile';


/**
 * The finished gown: a strapless sweetheart bodice fitted to the dress form, a gold sash at the
 * waist, and a full skirt with soft vertical folds that flares to a sweep train at the back.
 * Stylized, not a copy of any real garment. The surface materialises from the waist outward as the
 * particles land (uReveal), with a thin glowing edge on the dissolve front.
 */

const HEM_Y = 0.0;
const NECK_Y = 1.37;
/** The gown never comes closer than this to the dress form, so the form cannot show through. */
const CLEARANCE = 0.02;


/** Radius of the fitted bodice at a height (just off the form), and the skirt silhouette below. */
function baseRadius(y: number): number {
  if (y >= WAIST_Y) {
    // Bodice: waist 0.155 → bust 0.198 → top edge 0.19, following the form.
    const t = (y - WAIST_Y) / (NECK_Y - WAIST_Y);
    const bust = Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.5);
    return 0.155 + 0.045 * bust - 0.006 * Math.max(0, t - 0.8) * 5;
  }
  // Skirt: a soft hip that clears the dress form's hip (0.198) by about 0.02, then an A-line flare
  // that curves out toward the hem.
  const t = (WAIST_Y - y) / (WAIST_Y - HEM_Y);
  const hip = 0.042 * Math.sin(Math.min(1, t * 3.2) * Math.PI * 0.5);
  return 0.17 + hip + 0.55 * Math.pow(t, 1.35);
}

/**
 * Parametric gown surface. u: 0..1 around (0 = front, facing the camera at rest), v: 0..1 from the
 * hem up to the neckline. Folds and the back train only apply below the waist.
 */
export function gownPoint(u: number, v: number, out: Vector3): Vector3 {
  const angle = u * Math.PI * 2;
  // Sweetheart neckline: the top edge dips at the centre front and rises over the bust.
  const front = Math.cos(angle);
  const neckline = NECK_Y - 0.05 * Math.max(0, front) * Math.exp(-Math.pow(Math.sin(angle) * 5, 2)) + 0.012 * Math.max(0, front);
  const y = HEM_Y + (neckline - HEM_Y) * v;
  let radius = Math.max(baseRadius(y), torsoRadiusAt(y) + CLEARANCE);
  let yy = y;
  if (y < WAIST_Y) {
    const t = (WAIST_Y - y) / (WAIST_Y - HEM_Y);
    // Fourteen soft folds that deepen toward the hem and drift slightly around the skirt.
    radius += 0.032 * Math.pow(t, 1.2) * Math.sin(angle * 14 + t * 1.6);
    // Sweep train: the back of the skirt reaches further out and settles on the floor.
    const back = Math.max(0, -front);
    radius += 0.55 * Math.pow(t, 3.2) * Math.pow(back, 2.4);
    // A gently uneven hem, as fabric lands.
    if (t > 0.97) yy += 0.012 * Math.sin(angle * 9);
  }
  return out.set(Math.sin(angle) * radius, Math.max(HEM_Y, yy), front * radius * FORM_DEPTH);
}

const CHAMPAGNE_LIGHT = new Color('#e9c98f');
const CHAMPAGNE_DEEP = new Color('#94652f');

function buildSurface(columns: number, rows: number): BufferGeometry {
  const positions = new Float32Array((columns + 1) * (rows + 1) * 3);
  const colors = new Float32Array((columns + 1) * (rows + 1) * 3);
  const point = new Vector3();
  const color = new Color();
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns;
      const v = row / rows;
      gownPoint(u, v, point).toArray(positions, (row * (columns + 1) + column) * 3);
      // Lighter at the bodice, deepening toward the hem, like light falling from above.
      color.copy(CHAMPAGNE_DEEP).lerp(CHAMPAGNE_LIGHT, 0.35 + 0.65 * Math.pow(v, 0.8));
      color.toArray(colors, (row * (columns + 1) + column) * 3);
    }
  }
  const index: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column;
      const b = a + columns + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

const DISSOLVE_HEADER = /* glsl */ `
  uniform float uReveal;
  varying vec3 vGownPosition;
  float gownHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float gownNoise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float n000 = gownHash(i), n100 = gownHash(i + vec3(1, 0, 0)), n010 = gownHash(i + vec3(0, 1, 0)), n110 = gownHash(i + vec3(1, 1, 0));
    float n001 = gownHash(i + vec3(0, 0, 1)), n101 = gownHash(i + vec3(1, 0, 1)), n011 = gownHash(i + vec3(0, 1, 1)), n111 = gownHash(i + vec3(1, 1, 1));
    return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
  }
  // 0 at the waist, rising toward the neckline and (more slowly) the hem, with a grainy front.
  float gownFront() {
    float fromWaist = vGownPosition.y >= ${WAIST_Y.toFixed(3)} ? (vGownPosition.y - ${WAIST_Y.toFixed(3)}) * 1.6 : (${WAIST_Y.toFixed(3)} - vGownPosition.y) * 0.92;
    return fromWaist + gownNoise(vGownPosition * 16.0) * 0.16;
  }
`;

/** Satin with a dissolve: fragments beyond the reveal front are cut, and a thin edge glows gold. */
function createSatin(reveal: { value: number }): MeshPhysicalMaterial {
  const material = new MeshPhysicalMaterial({
    color: '#ffffff',
    vertexColors: true,
    metalness: 0.36,
    roughness: 0.34,
    sheen: 1,
    sheenColor: new Color('#fff3dc'),
    sheenRoughness: 0.32,
    clearcoat: 0.18,
    clearcoatRoughness: 0.35,
    envMapIntensity: 1.1,
    side: DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms['uReveal'] = reveal;
    shader.vertexShader = `varying vec3 vGownPosition;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vGownPosition = position;',
    );
    shader.fragmentShader = `${DISSOLVE_HEADER}\n${shader.fragmentShader}`
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n  float gownEdge = uReveal * 1.25 - gownFront();\n  if (gownEdge < 0.0) discard;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor.rgb += vec3(1.0, 0.82, 0.5) * (1.0 - smoothstep(0.0, 0.035, gownEdge)) * 1.4 * step(uReveal, 0.999);');
  };
  return material;
}

export function createGownDress(quality: 'high' | 'low') {
  const reveal = { value: 0 };
  const geometry = buildSurface(quality === 'high' ? 160 : 96, quality === 'high' ? 120 : 72);
  const satin = createSatin(reveal);
  const gown = new Mesh(geometry, satin);

  // A slim gold sash at the waist: the one hard line in the silhouette.
  // Sits over the seam where the fitted bodice (0.155) meets the fuller skirt (0.17).
  const sashGeometry = new TorusGeometry(0.168, 0.012, 12, 96);
  const sashMaterial = createSatin(reveal);
  sashMaterial.vertexColors = false;
  sashMaterial.color = new Color('#c9a46a');
  sashMaterial.metalness = 0.85;
  sashMaterial.roughness = 0.22;
  const sash = new Mesh(sashGeometry, sashMaterial);
  sash.rotation.x = Math.PI / 2;
  sash.position.y = WAIST_Y;
  sash.scale.set(1, FORM_DEPTH, 1);

  const group = new Group();
  group.add(gown, sash);
  return {
    group,
    /** 0 = nothing shown, 1 = the whole gown. */
    setReveal(value: number) {
      reveal.value = value;
      group.visible = value > 0.001;
    },
    dispose() {
      geometry.dispose();
      satin.dispose();
      sashGeometry.dispose();
      sashMaterial.dispose();
    },
  };
}
