/**
 * A tailor's pattern draft: bodice, skirt panel, and sleeve pieces on dotted pattern paper, with
 * cutting lines, dashed stitch lines, darts, notches, and grain arrows. Drawn here, not sourced, so
 * there is nothing to license or fetch. Purely decorative; it inherits `currentColor`.
 *
 * `id` keeps the paper-grid pattern unique when more than one draft is on a page.
 */

interface Piece {
  readonly transform: string;
  readonly cut: string;
  /** Inset of the stitch line, as a transform applied to the cutting line. */
  readonly stitch: string;
  readonly marks: readonly string[];
  readonly grain: readonly [x: number, top: number, bottom: number];
  readonly label: readonly [x: number, y: number, name: string, count: string];
}

const PIECES: readonly Piece[] = [
  {
    transform: 'translate(170 130) rotate(-6)',
    cut: 'M0 46 C38 46 66 28 78 0 L196 34 C176 96 182 146 220 176 L206 330 L0 340 Z',
    stitch: 'translate(11 11) scale(0.93)',
    marks: ['M88 338 L104 212 L120 336', 'M192 108 l12 4', 'M203 140 l12 2', 'M-14 46 L-14 340'],
    grain: [62, 110, 290],
    label: [108, 262, 'BODICE FRONT', 'CUT 1 ON FOLD'],
  },
  {
    transform: 'translate(640 70) rotate(4)',
    cut: 'M60 0 L230 0 L380 640 C260 668 30 668 -90 640 Z',
    stitch: 'translate(9 14) scale(0.95)',
    marks: ['M118 0 l0 14', 'M172 0 l0 14', 'M326 420 l-12 4', 'M-38 420 l12 4'],
    grain: [145, 140, 520],
    label: [150, 580, 'SKIRT PANEL', 'CUT 4'],
  },
  {
    transform: 'translate(1110 200) rotate(-10)',
    cut: 'M0 150 C34 52 98 0 160 0 C222 0 286 52 320 150 L282 470 L38 470 Z',
    stitch: 'translate(12 12) scale(0.925)',
    marks: ['M160 0 l0 14', 'M64 58 l10 8', 'M248 52 l-10 8', 'M234 64 l-10 8'],
    grain: [160, 110, 400],
    label: [160, 440, 'SLEEVE', 'CUT 2'],
  },
];

function GrainArrow({ x, top, bottom }: { x: number; top: number; bottom: number }) {
  return (
    <path
      d={`M${x} ${top} L${x} ${bottom} M${x - 8} ${top + 12} L${x} ${top} L${x + 8} ${top + 12} M${x - 8} ${bottom - 12} L${x} ${bottom} L${x + 8} ${bottom - 12}`}
      vectorEffect="non-scaling-stroke"
    />
  );
}

export function PatternDraft({ id, className }: { id: string; className?: string }) {
  const gridId = `${id}-paper`;
  return (
    <svg aria-hidden="true" focusable="false" className={className} viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id={gridId} width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M20 17v6M17 20h6" stroke="currentColor" strokeWidth="1" opacity="0.45" />
        </pattern>
      </defs>
      <rect width="1600" height="900" fill={`url(#${gridId})`} />
      <g fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
        {PIECES.map((piece) => (
          <g key={piece.label[2]} transform={piece.transform}>
            <path d={piece.cut} vectorEffect="non-scaling-stroke" />
            <path d={piece.cut} transform={piece.stitch} strokeDasharray="7 6" opacity="0.7" vectorEffect="non-scaling-stroke" />
            {piece.marks.map((mark) => (
              <path key={mark} d={mark} vectorEffect="non-scaling-stroke" />
            ))}
            <GrainArrow x={piece.grain[0]} top={piece.grain[1]} bottom={piece.grain[2]} />
            <g stroke="none" fill="currentColor" textAnchor="middle" fontSize="13" letterSpacing="3">
              <text x={piece.label[0]} y={piece.label[1]}>{piece.label[2]}</text>
              <text x={piece.label[0]} y={piece.label[1] + 20} fontSize="10" opacity="0.8">{piece.label[3]}</text>
            </g>
          </g>
        ))}
        {/* A dimension line along the skirt hem, as drafted on paper. */}
        <g transform="translate(550 790) rotate(4)" opacity="0.8">
          <path d="M0 0 L470 0 M0 -8 L0 8 M470 -8 L470 8 M12 -6 L0 0 L12 6 M458 -6 L470 0 L458 6" vectorEffect="non-scaling-stroke" />
          <text x="235" y="-10" stroke="none" fill="currentColor" textAnchor="middle" fontSize="12" letterSpacing="2">HEM 142 CM</text>
        </g>
      </g>
    </svg>
  );
}
