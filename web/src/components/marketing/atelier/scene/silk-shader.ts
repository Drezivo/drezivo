/**
 * Live silk backdrop. A height field of slow, domain-warped folds is lit like satin: a broad warm
 * diffuse term plus a narrow sheen along the fold crests, kept dark so the gown and the headline
 * stay the brightest things on screen. Film grain breaks the 8-bit banding a smooth dark gradient
 * would otherwise show. As the gown settles (uProgress), the folds calm and the light warms.
 */
export const SILK_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.999, 1.0);
  }
`;

export const SILK_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec2 uPointer;
  uniform float uProgress;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
      value += amplitude * noise(p);
      p = p * 2.03 + vec2(1.7, 9.2);
      amplitude *= 0.5;
    }
    return value;
  }

  // Long, slow folds running diagonally, like satin draped from the top left. Low frequency only:
  // a fine noise octave here reads as stone, not fabric.
  float folds(vec2 p, float t) {
    vec2 warp = vec2(fbm(p * 0.55 + vec2(t * 0.03, -t * 0.02)), fbm(p * 0.55 + vec2(5.2, 1.3) - t * 0.025));
    float calm = mix(1.0, 0.65, uProgress);
    float d = dot(p, normalize(vec2(1.0, -0.62))) * 1.7 + (warp.x * 2.4 + warp.y * 0.9) * calm;
    return sin(d + t * 0.08) * 0.5 + 0.5;
  }

  // Colours are authored in sRGB and converted, because the output pass converts back.
  vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }

  void main() {
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = vec2(vUv.x * aspect, vUv.y) * 1.2 + uPointer * 0.05;
    float t = uTime;
    float e = 0.01;
    float h = folds(p, t);
    vec3 n = normalize(vec3(folds(p + vec2(e, 0.0), t) - h, folds(p + vec2(0.0, e), t) - h, e * 1.2));

    vec3 light = normalize(vec3(-0.5, 0.6, 0.65));
    float diffuse = clamp(dot(n, light), 0.0, 1.0);
    vec3 halfway = normalize(light + vec3(0.0, 0.0, 1.0));
    float sheen = pow(clamp(dot(n, halfway), 0.0, 1.0), 60.0);

    vec3 night = srgb(vec3(0.071, 0.055, 0.043));
    vec3 umber = srgb(vec3(0.17, 0.12, 0.085));
    vec3 champagne = srgb(vec3(0.83, 0.70, 0.51));
    vec3 color = mix(night, umber, smoothstep(0.2, 1.0, diffuse) * mix(0.7, 0.85, uProgress));
    color += champagne * sheen * mix(0.05, 0.08, uProgress);

    // Light pools to the right where the gown stands; the left stays deep for the headline.
    float pool = smoothstep(1.1, 0.0, distance(vUv, vec2(0.72, 0.55)));
    color *= mix(0.45, 1.0, pool);
    float vignette = smoothstep(1.2, 0.3, distance(vUv, vec2(0.55, 0.5)));
    color *= mix(0.55, 1.0, vignette);

    float grain = (hash(vUv * uResolution + fract(t) * 91.0) - 0.5) * 0.006;
    gl_FragColor = vec4(color + grain, 1.0);
    #include <colorspace_fragment>
  }
`;
