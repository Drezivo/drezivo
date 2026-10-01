import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial, Vector3 } from 'three';

import { WAIST_Y } from './form-profile';
import { gownPoint } from './gown-dress';

/**
 * Gold microparticles that peel away from the floating ribbons and fly, each on its own curve, to
 * a place on the gown — bodice first, then down the skirt — so the dress is visibly built from the
 * scattered pieces. After landing they settle into a faint shimmer on the satin.
 *
 * All motion runs in the vertex shader from one progress uniform: no per-frame CPU work.
 */

const VERTEX = /* glsl */ `
  attribute vec3 aStart;
  attribute vec3 aTarget;
  attribute float aDelay;
  attribute float aSeed;
  uniform float uProgress;
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  varying float vAlpha;
  varying float vSpark;

  void main() {
    float t = clamp((uProgress - aDelay) / 0.3, 0.0, 1.0);
    float e = t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
    // A curved flight: up and around the form through a control point unique to each particle.
    vec3 lift = vec3(sin(aSeed * 6.283) * 0.55, 0.35 + 0.3 * sin(aSeed * 17.0), cos(aSeed * 6.283) * 0.55);
    vec3 control = mix(aStart, aTarget, 0.5) + lift;
    vec3 position3 = mix(mix(aStart, control, e), mix(control, aTarget, e), e);
    // In flight they swirl a little; landed, they breathe on the surface.
    position3 += vec3(sin(uTime * 1.3 + aSeed * 40.0), cos(uTime * 1.1 + aSeed * 31.0), sin(uTime * 0.9 + aSeed * 23.0)) * 0.012 * (1.0 - e * 0.7);

    vec4 mvPosition = modelViewMatrix * vec4(position3, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float settle = smoothstep(0.85, 1.0, t);
    gl_PointSize = uSize * uPixelRatio * mix(1.0, 0.55, settle) / -mvPosition.z;

    float twinkle = 0.5 + 0.5 * sin(uTime * (1.5 + aSeed * 2.0) + aSeed * 50.0);
    // Invisible until it leaves its ribbon; bright in flight; a faint shimmer once on the gown.
    vAlpha = smoothstep(0.0, 0.06, t) * mix(1.0, 0.12 + 0.3 * twinkle * twinkle, settle);
    vSpark = settle * twinkle;
  }
`;

const FRAGMENT = /* glsl */ `
  varying float vAlpha;
  varying float vSpark;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float disc = smoothstep(0.5, 0.0, d);
    vec3 gold = mix(vec3(1.0, 0.78, 0.45), vec3(1.0, 0.95, 0.82), disc * 0.6 + vSpark * 0.3);
    gl_FragColor = vec4(gold, disc * disc * vAlpha);
  }
`;

export interface ParticleSource {
  /** A point on one of the scattered ribbons (t 0..1 along it). */
  ribbonPoint(ribbon: number, t: number, out: Vector3): Vector3;
  ribbonCount: number;
}

/** Deterministic pseudo-random, so the gown builds the same way on every visit. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function createGownParticles(count: number, source: ParticleSource, pixelRatio: number) {
  const random = seeded(20261001);
  const starts = new Float32Array(count * 3);
  const targets = new Float32Array(count * 3);
  const delays = new Float32Array(count);
  const seeds = new Float32Array(count);
  const point = new Vector3();

  for (let i = 0; i < count; i += 1) {
    // Area-weighted target on the gown: the wide skirt gets more particles than the narrow bodice.
    let u = 0;
    let v = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      u = random();
      v = random();
      gownPoint(u, v, point);
      if (random() < Math.hypot(point.x, point.z) / 0.85) break;
    }
    gownPoint(u, v, point).toArray(targets, i * 3);
    // Bodice first, then outward down the skirt; a little randomness so it never looks banded.
    const fromWaist = point.y >= WAIST_Y ? (point.y - WAIST_Y) * 1.2 : (WAIST_Y - point.y) * 0.62;
    delays[i] = 0.22 + fromWaist * 0.42 + random() * 0.1;
    source.ribbonPoint(Math.floor(random() * source.ribbonCount), random(), point).toArray(starts, i * 3);
    seeds[i] = random();
  }

  const geometry = new BufferGeometry();
  // `position` is required by three for bounds; the shader uses aStart/aTarget.
  geometry.setAttribute('position', new BufferAttribute(targets.slice(), 3));
  geometry.setAttribute('aStart', new BufferAttribute(starts, 3));
  geometry.setAttribute('aTarget', new BufferAttribute(targets, 3));
  geometry.setAttribute('aDelay', new BufferAttribute(delays, 1));
  geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));

  const uniforms = {
    uProgress: { value: 0 },
    uTime: { value: 0 },
    uSize: { value: 22 },
    uPixelRatio: { value: pixelRatio },
  };
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    update(progress: number, time: number) {
      uniforms.uProgress.value = progress;
      uniforms.uTime.value = time;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
