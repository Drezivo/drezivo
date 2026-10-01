/**
 * A tailor's tape measure, drawn as SVG: centimetre ticks, longer half and full marks, a number
 * every ten centimetres, and the brass tip at zero. Decorative; place it behind content.
 */

const CENTIMETRES = 130;
const PX_PER_CM = 12;
const START_X = 36;
const BAND_TOP = 18;
const BAND_HEIGHT = 84;

function tickLength(cm: number): number {
  if (cm % 10 === 0) return 36;
  if (cm % 5 === 0) return 26;
  return 14;
}

const TICKS = Array.from({ length: CENTIMETRES + 1 }, (_, cm) => {
  const x = START_X + cm * PX_PER_CM;
  return `M${x} ${BAND_TOP} v${tickLength(cm)}`;
}).join(' ');

const LABELS = Array.from({ length: CENTIMETRES / 10 - 1 }, (_, index) => (index + 1) * 10);

const WIDTH = START_X + CENTIMETRES * PX_PER_CM + 24;

export function TapeMeasure({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" className={className} viewBox={`0 0 ${WIDTH} 120`} preserveAspectRatio="xMinYMid meet">
      <rect x="0" y={BAND_TOP} width={WIDTH} height={BAND_HEIGHT} rx="3" fill="var(--color-atelier-champagne)" opacity="0.32" />
      <rect x="0" y={BAND_TOP} width={WIDTH} height={BAND_HEIGHT} rx="3" fill="none" stroke="var(--color-atelier-gold)" strokeWidth="1" opacity="0.5" />
      {/* Brass tip at zero. */}
      <rect x="0" y={BAND_TOP - 4} width="22" height={BAND_HEIGHT + 8} rx="2" fill="var(--color-atelier-gold)" opacity="0.55" />
      <path d={TICKS} stroke="var(--color-atelier-gold-ink)" strokeWidth="1.25" opacity="0.6" />
      <g fill="var(--color-atelier-gold-ink)" opacity="0.65" fontSize="17" textAnchor="middle">
        {LABELS.map((cm) => (
          <text key={cm} x={START_X + cm * PX_PER_CM} y={BAND_TOP + 64}>{cm}</text>
        ))}
      </g>
    </svg>
  );
}
