import {
  ACESFilmicToneMapping,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { FORM_DEPTH, FORM_TOP, TORSO_PROFILE, torsoRadiusAt, WAIST_Y } from './form-profile';
import { createGownDress } from './gown-dress';
import { createGownParticles } from './gown-particles';
import { SILK_FRAGMENT, SILK_VERTEX } from './silk-shader';

/**
 * The hero's single WebGL scene: a live silk backdrop and Drezivo's mark rebuilt in 3D — satin
 * ribbons that float apart (a shop's scattered tools) and wrap a dress form into a gown as the
 * visitor scrolls (everything in one place). Stylized, not a reconstruction of any real garment.
 *
 * Everything runs in ONE renderer and canvas: the backdrop is a full-screen triangle drawn first,
 * so no second WebGL context competes for the GPU. Rendering pauses whenever the canvas is off
 * screen or the tab is hidden, and reduced motion renders a single settled frame.
 */

export type SceneQuality = 'high' | 'low';

export interface AtelierScene {
  /** 0 = ribbons scattered, 1 = gown fully wrapped. Driven by scroll. */
  setProgress(progress: number): void;
  /** Pointer in -1..1 for a few degrees of parallax. */
  setPointer(x: number, y: number): void;
  resize(width: number, height: number): void;
  /** Resolves after the first frame is on screen (the preloader waits for it). */
  readonly ready: Promise<void>;
  dispose(): void;
}

interface RibbonSpec {
  /** Angle around the form where the ribbon leaves the bodice. */
  angle: number;
  /** How far it wraps around the skirt, in turns. */
  turns: number;
  topY: number;
  hemY: number;
  hemRadius: number;
  width: number;
  /** Extra outward sweep at the tip: the train in the logo. */
  train: number;
  twist: number;
  /** Where it floats before it wraps (scattered state). */
  scatter: Vector3;
  scatterTilt: number;
  /** Stagger so ribbons arrive one after another. */
  delay: number;
  shade: number;
}

const SEGMENTS_HIGH = 140;
const SEGMENTS_LOW = 80;
const RIBBONS: readonly RibbonSpec[] = [
  // Two ribbons leave opposite shoulders and cross over the bodice, as in the mark.
  { angle: 0.6, turns: 0.38, topY: 1.42, hemY: 0.02, hemRadius: 0.72, width: 0.2, train: 0.95, twist: 0.6, scatter: new Vector3(-1.5, 1.6, -0.4), scatterTilt: 0.9, delay: 0, shade: 1 },
  { angle: 2.55, turns: -0.4, topY: 1.42, hemY: 0.04, hemRadius: 0.64, width: 0.19, train: 0.15, twist: -0.5, scatter: new Vector3(1.4, 1.9, -0.8), scatterTilt: -0.7, delay: 0.08, shade: 0.84 },
  { angle: 3.9, turns: 0.3, topY: 1.2, hemY: 0.0, hemRadius: 0.7, width: 0.22, train: 0.25, twist: 0.8, scatter: new Vector3(-1.2, 0.3, 0.6), scatterTilt: 0.4, delay: 0.16, shade: 0.92 },
  { angle: 5.3, turns: -0.5, topY: 1.26, hemY: 0.03, hemRadius: 0.62, width: 0.19, train: 0.1, twist: -0.9, scatter: new Vector3(1.6, 0.5, 0.2), scatterTilt: -1.1, delay: 0.24, shade: 0.78 },
  // The long train that sweeps out along the floor.
  { angle: 1.2, turns: 0.6, topY: 1.1, hemY: 0.01, hemRadius: 0.82, width: 0.26, train: 1.35, twist: 0.4, scatter: new Vector3(0.2, -0.2, 1.1), scatterTilt: 1.4, delay: 0.32, shade: 1.08 },
  { angle: 4.6, turns: 0.25, topY: 1.4, hemY: 0.5, hemRadius: 0.42, width: 0.14, train: 0.0, twist: 1.1, scatter: new Vector3(-0.3, 2.3, -0.5), scatterTilt: -0.3, delay: 0.4, shade: 0.95 },
  // Two mid-length panels that fill the skirt between the long ribbons.
  { angle: 3.2, turns: -0.22, topY: 1.04, hemY: 0.08, hemRadius: 0.58, width: 0.24, train: 0.0, twist: 0.3, scatter: new Vector3(1.1, -0.1, -0.9), scatterTilt: 0.8, delay: 0.46, shade: 0.7 },
  { angle: 0.1, turns: 0.2, topY: 1.04, hemY: 0.06, hemRadius: 0.6, width: 0.23, train: 0.3, twist: -0.4, scatter: new Vector3(-1.7, 1.0, 0.3), scatterTilt: -1.3, delay: 0.52, shade: 0.88 },
];

const GOLD_LIGHT = new Color('#f2d9a6');
const GOLD_DEEP = new Color('#8a5f2c');

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/**
 * Point on the wrapped gown. Above the waist the ribbon hugs the bodice just off its surface; below
 * it the skirt flares toward the hem, and the train ribbons sweep out along the floor, as in the mark.
 */
function ribbonWrapPoint(spec: RibbonSpec, t: number, out: Vector3): Vector3 {
  const y = spec.topY + (spec.hemY - spec.topY) * t;
  const waistRadius = torsoRadiusAt(WAIST_Y) + 0.012;
  let radius: number;
  if (y >= WAIST_Y) {
    radius = torsoRadiusAt(y) + 0.012;
  } else {
    const below = (WAIST_Y - y) / Math.max(0.001, WAIST_Y - spec.hemY);
    // Hug the hip first (the form is still there down to 0.84), then flare.
    const hip = y >= 0.84 ? torsoRadiusAt(y) + 0.012 : waistRadius;
    radius = Math.max(hip, waistRadius + (spec.hemRadius - waistRadius) * Math.pow(below, 1.7));
  }
  const angle = spec.angle + spec.turns * Math.PI * 2 * t;
  const sweep = spec.train * Math.pow(t, 3);
  return out.set(Math.cos(angle) * radius + sweep, y, Math.sin(angle) * radius * FORM_DEPTH - sweep * 0.35);
}

/** Point on the floating ribbon: a loose S-curve hanging in the air beside the form. */
function scatterPoint(spec: RibbonSpec, t: number, time: number, out: Vector3): Vector3 {
  const s = t - 0.5;
  const drift = Math.sin(time * 0.35 + spec.angle) * 0.08;
  const x = spec.scatter.x + Math.sin(s * 3.2 + spec.scatterTilt) * 0.35 + s * Math.cos(spec.scatterTilt) * 0.9;
  const y = spec.scatter.y - s * 1.1 + Math.cos(s * 2.4 + spec.angle) * 0.18 + drift;
  const z = spec.scatter.z + Math.sin(s * 2.0 + spec.angle) * 0.4;
  return out.set(x, y, z);
}

class Ribbon {
  readonly mesh: Mesh;
  private readonly geometry = new BufferGeometry();
  private readonly positions: Float32Array;
  private readonly spine: Vector3[];
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly tangent = new Vector3();
  private readonly side = new Vector3();
  private readonly outward = new Vector3();

  constructor(
    private readonly spec: RibbonSpec,
    private readonly segments: number,
    material: MeshPhysicalMaterial,
  ) {
    const vertexCount = (segments + 1) * 2;
    this.positions = new Float32Array(vertexCount * 3);
    this.spine = Array.from({ length: segments + 1 }, () => new Vector3());
    const colors = new Float32Array(vertexCount * 3);
    const index: number[] = [];
    const color = new Color();
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      // Gold-leaf banding along the ribbon, like the brushed gradient in the mark.
      color.copy(GOLD_DEEP).lerp(GOLD_LIGHT, 0.5 + 0.5 * Math.sin(t * 9 + spec.angle * 2)).multiplyScalar(spec.shade);
      for (let side = 0; side < 2; side += 1) color.toArray(colors, (i * 2 + side) * 3);
      if (i < segments) {
        const v = i * 2;
        index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new BufferAttribute(colors, 3));
    this.geometry.setIndex(index);
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
  }

  update(progress: number, time: number): void {
    const local = smooth(clamp01((progress - this.spec.delay) / 0.6));
    for (let i = 0; i <= this.segments; i += 1) {
      const t = i / this.segments;
      ribbonWrapPoint(this.spec, t, this.a);
      scatterPoint(this.spec, t, time, this.b);
      // A soft travelling wave keeps the satin alive even when the gown is settled.
      const wave = Math.sin(t * 10 - time * 1.4 + this.spec.angle) * 0.018 * t;
      this.spine[i]!.copy(this.b).lerp(this.a, local).addScalar(wave);
    }
    for (let i = 0; i <= this.segments; i += 1) {
      const t = i / this.segments;
      const prev = this.spine[Math.max(0, i - 1)]!;
      const next = this.spine[Math.min(this.segments, i + 1)]!;
      const point = this.spine[i]!;
      this.tangent.subVectors(next, prev).normalize();
      // Width lies along the surface of the skirt: perpendicular to the tangent and the outward normal.
      this.outward.set(point.x, 0, point.z);
      if (this.outward.lengthSq() < 1e-6) this.outward.set(1, 0, 0);
      this.outward.normalize();
      this.side.crossVectors(this.tangent, this.outward).normalize();
      const twist = this.spec.twist * Math.sin(t * Math.PI * 1.5 + time * 0.25) * (1 - local * 0.6);
      this.side.applyAxisAngle(this.tangent, twist);
      const width = this.spec.width * Math.pow(Math.sin(Math.PI * (0.06 + 0.9 * t)), 0.75) * (0.45 + 0.55 * t);
      const half = width / 2;
      this.positions.set([point.x - this.side.x * half, point.y - this.side.y * half, point.z - this.side.z * half], i * 6);
      this.positions.set([point.x + this.side.x * half, point.y + this.side.y * half, point.z + this.side.z * half], i * 6 + 3);
    }
    const position = this.geometry.getAttribute('position') as BufferAttribute;
    position.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

/** Dress form torso (neck to hip), lathed from a measured-feeling profile, with a gold neck cap. */
function createDressForm(): { group: Group; dispose: () => void } {
  const profile = TORSO_PROFILE.map(([r, y]) => new Vector2(r, y));
  const torsoGeometry = new LatheGeometry(profile, 72);
  // Dark linen with a little sheen, so the rim light draws the silhouette against the night.
  const torsoMaterial = new MeshPhysicalMaterial({
    color: '#241b16',
    roughness: 0.78,
    metalness: 0,
    sheen: 0.6,
    sheenColor: new Color('#8a6a4c'),
    sheenRoughness: 0.6,
  });
  const torso = new Mesh(torsoGeometry, torsoMaterial);
  torso.scale.z = FORM_DEPTH;
  const capGeometry = new SphereGeometry(0.045, 32, 16);
  const capMaterial = new MeshPhysicalMaterial({ color: '#c9a46a', metalness: 0.85, roughness: 0.25 });
  const cap = new Mesh(capGeometry, capMaterial);
  cap.position.y = FORM_TOP;
  cap.scale.set(1, 0.42, 1);
  // The stand: a slim brass pole and a weighted disc base, so the form never floats.
  const poleGeometry = new CylinderGeometry(0.012, 0.012, 0.84, 16);
  const pole = new Mesh(poleGeometry, capMaterial);
  pole.position.y = 0.42;
  const baseGeometry = new CylinderGeometry(0.16, 0.18, 0.025, 48);
  const base = new Mesh(baseGeometry, capMaterial);
  base.position.y = 0.0125;
  const group = new Group();
  group.add(torso, cap, pole, base);
  return {
    group,
    dispose: () => {
      torsoGeometry.dispose();
      torsoMaterial.dispose();
      capGeometry.dispose();
      capMaterial.dispose();
      poleGeometry.dispose();
      baseGeometry.dispose();
    },
  };
}

export function createAtelierScene(
  canvas: HTMLCanvasElement,
  options: { quality: SceneQuality; animate: boolean },
): AtelierScene {
  const renderer = new WebGLRenderer({ canvas, antialias: options.quality === 'high', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, options.quality === 'high' ? 1.75 : 1.25));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor('#120e0b', 1);

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;

  const camera = new PerspectiveCamera(30, 1, 0.1, 50);

  // Backdrop: one full-screen triangle with the silk shader, drawn before everything else.
  const silkUniforms = {
    uTime: { value: 0 },
    uResolution: { value: new Vector2(1, 1) },
    uPointer: { value: new Vector2(0, 0) },
    uProgress: { value: 0 },
  };
  const backdropGeometry = new BufferGeometry();
  backdropGeometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const backdropMaterial = new ShaderMaterial({
    vertexShader: SILK_VERTEX,
    fragmentShader: SILK_FRAGMENT,
    uniforms: silkUniforms,
    depthTest: false,
    depthWrite: false,
  });
  const backdrop = new Mesh(backdropGeometry, backdropMaterial);
  backdrop.frustumCulled = false;
  backdrop.renderOrder = -1;
  scene.add(backdrop);

  // A soft contact shadow so the gown stands on something.
  const shadowGeometry = new PlaneGeometry(2.6, 2.6);
  const shadowMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec2 vUv; uniform float uOpacity; void main(){ float d = distance(vUv, vec2(0.5)); gl_FragColor = vec4(0.0, 0.0, 0.0, smoothstep(0.5, 0.0, d) * uOpacity); }',
    uniforms: { uOpacity: { value: 0 } },
  });
  const shadow = new Mesh(shadowGeometry, shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.0;

  const gown = new Group();
  const form = createDressForm();
  gown.add(form.group, shadow);
  const ribbonMaterial = new MeshPhysicalMaterial({
    color: '#ffffff',
    vertexColors: true,
    metalness: 0.62,
    roughness: 0.3,
    sheen: 0.7,
    sheenColor: new Color('#fff0d4'),
    sheenRoughness: 0.45,
    clearcoat: 0.25,
    clearcoatRoughness: 0.4,
    envMapIntensity: 1.15,
    side: DoubleSide,
    // The ribbons hand over to the particles and dissolve away.
    transparent: true,
  });
  const segments = options.quality === 'high' ? SEGMENTS_HIGH : SEGMENTS_LOW;
  const ribbons = RIBBONS.map((spec) => new Ribbon(spec, segments, ribbonMaterial));
  for (const ribbon of ribbons) gown.add(ribbon.mesh);

  // The finished dress and the particles that build it.
  const dress = createGownDress(options.quality);
  gown.add(dress.group);
  // Particles start where the ribbons float in the first frame.
  const particles = createGownParticles(
    options.quality === 'high' ? 6000 : 2600,
    { ribbonCount: RIBBONS.length, ribbonPoint: (index, t, out) => scatterPoint(RIBBONS[index]!, t, 0, out) },
    renderer.getPixelRatio(),
  );
  gown.add(particles.points);
  scene.add(gown);

  scene.add(new AmbientLight('#fff4e6', 0.25));
  const key = new DirectionalLight('#ffe9c8', 2.4);
  key.position.set(-2.5, 3.2, 3);
  const rim = new DirectionalLight('#d9c4ff', 1.1);
  rim.position.set(2.8, 2.4, -2.5);
  const fill = new DirectionalLight('#ffd7a8', 0.5);
  fill.position.set(2, 0.5, 3);
  scene.add(key, rim, fill);

  let progress = 0;
  let targetProgress = 0;
  const pointer = new Vector2(0, 0);
  const pointerTarget = new Vector2(0, 0);
  let width = 1;
  let height = 1;
  let visible = true;
  let frame = 0;
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const start = performance.now();
  let disposed = false;

  const layout = () => {
    const aspect = width / Math.max(1, height);
    camera.aspect = aspect;
    // Wide screens keep the gown in the right third beside the headline; tall phones center it lower.
    const wide = aspect > 1.15;
    // On phones the copy sits in the lower half, so the whole finished gown (skirt and train included)
    // stands in the upper half of the screen.
    gown.position.set(wide ? Math.min(1.05, 0.55 + (aspect - 1.15) * 0.6) : 0, 0, 0);
    camera.position.set(0, wide ? 0.95 : 1.1, wide ? 4.6 : 9.2);
    camera.lookAt(0, wide ? 0.82 : -0.25, 0);
    camera.updateProjectionMatrix();
  };

  const render = (now: number) => {
    const time = (now - start) / 1000;
    progress += (targetProgress - progress) * (options.animate ? 0.08 : 1);
    pointer.lerp(pointerTarget, options.animate ? 0.05 : 1);
    const clock = options.animate ? time : 0;
    // Timeline: ribbons drift in (0-0.5), particles leave them and land (0.22-1), ribbons fade
    // (0.38-0.7), and the satin follows the particles outward from the waist (0.42-0.95).
    for (const ribbon of ribbons) ribbon.update(Math.min(1, progress / 0.5), clock);
    ribbonMaterial.opacity = 1 - smooth(clamp01((progress - 0.38) / 0.32));
    ribbonMaterial.visible = ribbonMaterial.opacity > 0.01;
    particles.update(progress, clock);
    dress.setReveal(smooth(clamp01((progress - 0.42) / 0.53)));
    gown.rotation.y = (options.animate ? time * 0.12 : 0.4) + progress * Math.PI * 0.55 + pointer.x * 0.15;
    gown.rotation.x = pointer.y * 0.04;
    shadowMaterial.uniforms['uOpacity']!.value = 0.45 * smooth(clamp01(progress));
    silkUniforms.uTime.value = options.animate ? time : 8;
    silkUniforms.uPointer.value.copy(pointer);
    silkUniforms.uProgress.value = progress;
    renderer.render(scene, camera);
  };

  const loop = (now: number) => {
    if (disposed) return;
    if (visible && document.visibilityState === 'visible') render(now);
    frame = requestAnimationFrame(loop);
  };

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
  });
  observer.observe(canvas);

  const api: AtelierScene = {
    setProgress(value) {
      // Reduced motion shows the settled gown only; scroll never animates it.
      if (!options.animate) return;
      targetProgress = clamp01(value);
    },
    setPointer(x, y) {
      pointerTarget.set(x, y);
    },
    resize(nextWidth, nextHeight) {
      width = Math.max(1, nextWidth);
      height = Math.max(1, nextHeight);
      renderer.setSize(width, height, false);
      silkUniforms.uResolution.value.set(width, height);
      layout();
      if (!options.animate) render(performance.now());
    },
    ready,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      for (const ribbon of ribbons) ribbon.dispose();
      ribbonMaterial.dispose();
      dress.dispose();
      particles.dispose();
      form.dispose();
      backdropGeometry.dispose();
      backdropMaterial.dispose();
      shadowGeometry.dispose();
      shadowMaterial.dispose();
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };

  const rect = canvas.getBoundingClientRect();
  api.resize(rect.width, rect.height);
  if (!options.animate) targetProgress = progress = 1;
  render(performance.now());
  requestAnimationFrame(() => resolveReady());
  if (options.animate) frame = requestAnimationFrame(loop);
  return api;
}
