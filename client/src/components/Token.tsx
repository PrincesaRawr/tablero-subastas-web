import { COLORS, COLOR_LABEL, COLOR_SYMBOL, type Color } from '../../../shared/config';

/** Paleta de cada ficha: medallón, borde, brillo y pelaje del gatito. */
export const PALETTE: Record<Color, { main: string; dark: string; light: string; fur: string; furDark: string }> = {
  rosa: { main: '#f06fb0', dark: '#b8407f', light: '#ffc2e1', fur: '#fff3f8', furDark: '#f7b6d2' },
  azul: { main: '#5b80d8', dark: '#34529f', light: '#a9c0f3', fur: '#cfd0dc', furDark: '#8e8fa3' },
  naranja: { main: '#f5a53c', dark: '#bf7316', light: '#ffd596', fur: '#f9c58c', furDark: '#d98a3e' },
  verde: { main: '#5faf4e', dark: '#367a2d', light: '#b0dd9b', fur: '#f3cf9c', furDark: '#c98f4a' },
  morado: { main: '#9d72db', dark: '#6943a8', light: '#d3bdf4', fur: '#d6d2df', furDark: '#958fa6' },
};

const SCALLOPS = Array.from({ length: 18 }, (_, i) => {
  const a = (i / 18) * Math.PI * 2;
  return { x: 50 + Math.cos(a) * 41, y: 50 + Math.sin(a) * 41 };
});

function TokenSymbol({ color }: { color: Color }) {
  const c = PALETTE[color];
  return (
    <symbol id={`token-${color}`} viewBox="0 0 100 100">
      {/* medallón festoneado */}
      {SCALLOPS.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={8} fill={c.dark} />
      ))}
      <circle cx={50} cy={50} r={41} fill={c.dark} />
      <circle cx={50} cy={50} r={38} fill={`url(#grad-${color})`} />
      <circle cx={50} cy={50} r={31} fill="none" stroke={c.light} strokeWidth={1.5} strokeDasharray="1.5 3.5" opacity={0.8} />
      {/* laureles */}
      {[0, 1, 2].map((i) => (
        <g key={i} fill={c.light} opacity={0.75}>
          <ellipse cx={27 - i * 1.5} cy={56 + i * 7} rx={2.5} ry={5} transform={`rotate(${-35 + i * 12} ${27 - i * 1.5} ${56 + i * 7})`} />
          <ellipse cx={73 + i * 1.5} cy={56 + i * 7} rx={2.5} ry={5} transform={`rotate(${35 - i * 12} ${73 + i * 1.5} ${56 + i * 7})`} />
        </g>
      ))}
      {/* orejas */}
      <path d="M32 44 L33 24 L46 35 Z" fill={c.fur} stroke={c.furDark} strokeWidth={1.2} strokeLinejoin="round" />
      <path d="M68 44 L67 24 L54 35 Z" fill={c.fur} stroke={c.furDark} strokeWidth={1.2} strokeLinejoin="round" />
      <path d="M35 37 L35.5 28 L42 34 Z" fill="#f7a8c8" />
      <path d="M65 37 L64.5 28 L58 34 Z" fill="#f7a8c8" />
      {/* cabeza */}
      <ellipse cx={50} cy={50} rx={21} ry={17.5} fill={c.fur} stroke={c.furDark} strokeWidth={1.2} />
      <path d="M44 34 Q50 38 56 34" stroke={c.furDark} strokeWidth={1.4} fill="none" opacity={0.7} />
      {/* corona */}
      <path d="M40 31 L42 21 L46 27 L50 18 L54 27 L58 21 L60 31 Z" fill="#ffd45e" stroke="#c98a12" strokeWidth={1.1} strokeLinejoin="round" />
      <circle cx={50} cy={27.5} r={2} fill={c.main} stroke="#fff" strokeWidth={0.6} />
      {/* cara */}
      <ellipse cx={42} cy={50} rx={3} ry={3.6} fill="#2b1b3d" />
      <ellipse cx={58} cy={50} rx={3} ry={3.6} fill="#2b1b3d" />
      <circle cx={43} cy={48.6} r={1.1} fill="#fff" />
      <circle cx={59} cy={48.6} r={1.1} fill="#fff" />
      <ellipse cx={36.5} cy={56} rx={3.6} ry={2.2} fill="#ff8fbf" opacity={0.75} />
      <ellipse cx={63.5} cy={56} rx={3.6} ry={2.2} fill="#ff8fbf" opacity={0.75} />
      <path d="M48.5 54.5 L51.5 54.5 L50 56 Z" fill="#e0628f" />
      <path d="M46 57 Q48 59.5 50 57 Q52 59.5 54 57" stroke="#2b1b3d" strokeWidth={1.1} fill="none" strokeLinecap="round" />
      {/* lazo */}
      <path d="M50 70 L39 64 L39 76 Z" fill={c.main} stroke={c.dark} strokeWidth={1.2} strokeLinejoin="round" />
      <path d="M50 70 L61 64 L61 76 Z" fill={c.main} stroke={c.dark} strokeWidth={1.2} strokeLinejoin="round" />
      <circle cx={50} cy={70} r={3.2} fill={c.light} stroke={c.dark} strokeWidth={1.1} />
    </symbol>
  );
}

/** Se monta una sola vez: define los símbolos <use> de las fichas. */
export function TokenSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        {COLORS.map((color) => (
          <radialGradient key={color} id={`grad-${color}`} cx="40%" cy="35%" r="70%">
            <stop offset="0%" stopColor={PALETTE[color].light} />
            <stop offset="65%" stopColor={PALETTE[color].main} />
            <stop offset="100%" stopColor={PALETTE[color].dark} />
          </radialGradient>
        ))}
        {COLORS.map((color) => (
          <TokenSymbol key={color} color={color} />
        ))}
      </defs>
    </svg>
  );
}

interface TokenProps {
  color: Color;
  size?: number | string;
  className?: string;
  /** Oculta el símbolo de accesibilidad (por ejemplo en miniaturas muy pequeñas). */
  noSymbol?: boolean;
  title?: string;
}

export function Token({ color, size = '100%', className = '', noSymbol, title }: TokenProps) {
  return (
    <span className={`token ${className}`} style={{ width: size, height: size }} role="img" aria-label={title ?? COLOR_LABEL[color]}>
      <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
        <use href={`#token-${color}`} />
      </svg>
      {!noSymbol && (
        <span className="token-symbol" style={{ background: PALETTE[color].dark }} aria-hidden="true">
          {COLOR_SYMBOL[color]}
        </span>
      )}
    </span>
  );
}
