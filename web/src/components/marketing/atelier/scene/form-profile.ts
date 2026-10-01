/**
 * The dress form's measurements, shared by everything that has to sit on it: the lathed torso, the
 * ribbons that wrap it, and the gown that must clear it. One table, so they can never disagree.
 */

export const FORM_TOP = 1.56;
export const WAIST_Y = 1.04;
/** Dress forms are oval in plan: narrower front-to-back than side-to-side. */
export const FORM_DEPTH = 0.74;

/** Torso profile as [radius, height] pairs, from the hip up to the neck. */
export const TORSO_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0.84], [0.165, 0.84], [0.198, 0.9], [0.196, 0.97], [0.142, WAIST_Y], [0.16, 1.16], [0.19, 1.27],
  [0.186, 1.36], [0.2, 1.42], [0.17, 1.455], [0.06, 1.475], [0.042, 1.5], [0.042, 1.54], [0.0, 1.545],
];

/** Torso radius at a height, interpolated from the profile (outside the torso: 0). */
export function torsoRadiusAt(y: number): number {
  for (let i = 1; i < TORSO_PROFILE.length; i += 1) {
    const [r0, y0] = TORSO_PROFILE[i - 1]!;
    const [r1, y1] = TORSO_PROFILE[i]!;
    if (y >= Math.min(y0, y1) && y <= Math.max(y0, y1) && y1 !== y0) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return 0;
}
