// Hand-drawn SVG condition icons. No icon-font or sprite dependency — the set
// is small enough to inline, and inlining means they inherit currentColor and
// scale cleanly from the 20px hourly strip up to the 120px hero.

import { useId } from 'react';

const Cloud = ({ opacity = 1, ...p }) => (
  <path
    d="M25 42h30a11 11 0 0 0 1.2-21.9A16 16 0 0 0 26.4 15 12 12 0 0 0 25 42Z"
    fill="currentColor"
    opacity={opacity}
    {...p}
  />
);

const Sun = ({ cx = 32, cy = 26, r = 11 }) => (
  <>
    <circle cx={cx} cy={cy} r={r} fill="#fbbf24" />
    {[...Array(8)].map((_, i) => {
      const a = (i * Math.PI) / 4;
      return (
        <line
          key={i}
          x1={cx + Math.cos(a) * (r + 4)}
          y1={cy + Math.sin(a) * (r + 4)}
          x2={cx + Math.cos(a) * (r + 8)}
          y2={cy + Math.sin(a) * (r + 8)}
          stroke="#fbbf24"
          strokeWidth="3"
          strokeLinecap="round"
        />
      );
    })}
  </>
);

// Crescent via a mask: a lit disc with an offset disc bitten out of it. Done
// with arcs instead, the flags are fiddly and degenerate at some radii — this
// is exact at every size. `uid` keeps the mask id unique when a screen renders
// dozens of these at once.
const Moon = ({ cx = 32, cy = 26, r = 11, uid = 'x' }) => {
  const id = `qm-${uid}`;
  return (
    <>
      <defs>
        <mask id={id}>
          <rect x="0" y="0" width="64" height="72" fill="black" />
          <circle cx={cx} cy={cy} r={r} fill="white" />
          <circle cx={cx + r * 0.52} cy={cy - r * 0.4} r={r * 0.94} fill="black" />
        </mask>
      </defs>
      <rect x="0" y="0" width="64" height="72" fill="#e2e8f0" mask={`url(#${id})`} />
    </>
  );
};

// The moon has no rays to peek out from behind a cloud the way the sun does,
// so in the combined night icons the cloud is nudged down-right and shrunk to
// leave the crescent visible at the top-left.
const NightCloud = (props) => (
  <g transform="translate(7,11) scale(0.80)">
    <Cloud {...props} />
  </g>
);

const drops = (color, count = 3, y = 46) =>
  [...Array(count)].map((_, i) => (
    <line
      key={i}
      x1={22 + i * 10}
      y1={y}
      x2={19 + i * 10}
      y2={y + 9}
      stroke={color}
      strokeWidth="3"
      strokeLinecap="round"
    />
  ));

const flakes = (count = 3, y = 50) =>
  [...Array(count)].map((_, i) => (
    <g key={i} stroke="#e0f2fe" strokeWidth="2.2" strokeLinecap="round">
      <line x1={20 + i * 10} y1={y - 4} x2={20 + i * 10} y2={y + 4} />
      <line x1={16.5 + i * 10} y1={y - 2} x2={23.5 + i * 10} y2={y + 2} />
      <line x1={16.5 + i * 10} y1={y + 2} x2={23.5 + i * 10} y2={y - 2} />
    </g>
  ));

const Bolt = () => (
  <path d="M34 44l-9 13h7l-3 11 11-15h-7l4-9z" fill="#fde047" stroke="none" />
);

const SHAPES = {
  sun: () => <Sun cx={32} cy={32} r={14} />,
  moon: (uid) => <Moon cx={32} cy={32} r={15} uid={uid} />,
  'sun-cloud': () => (
    <>
      <Sun cx={24} cy={20} r={9} />
      <Cloud opacity={0.95} />
    </>
  ),
  'moon-cloud': (uid) => (
    <>
      <Moon cx={21} cy={15} r={10} uid={uid} />
      <NightCloud opacity={0.95} />
    </>
  ),
  'cloud-sun': () => (
    <>
      <Sun cx={42} cy={18} r={8} />
      <Cloud />
    </>
  ),
  'cloud-moon': (uid) => (
    <>
      <Moon cx={21} cy={15} r={10} uid={uid} />
      <NightCloud />
    </>
  ),
  cloud: () => <Cloud />,
  fog: () => (
    <>
      <Cloud opacity={0.75} />
      {[0, 1, 2].map((i) => (
        <line
          key={i}
          x1={16}
          y1={48 + i * 6}
          x2={48}
          y2={48 + i * 6}
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          opacity={0.6 - i * 0.15}
        />
      ))}
    </>
  ),
  drizzle: () => (
    <>
      <Cloud />
      {drops('#93c5fd', 3, 46)}
    </>
  ),
  rain: () => (
    <>
      <Cloud />
      {drops('#60a5fa', 3, 46)}
    </>
  ),
  'rain-heavy': () => (
    <>
      <Cloud />
      {drops('#3b82f6', 3, 46)}
      {drops('#3b82f6', 3, 54)}
    </>
  ),
  showers: () => (
    <>
      <Cloud />
      {drops('#60a5fa', 2, 47)}
    </>
  ),
  sleet: () => (
    <>
      <Cloud />
      {drops('#93c5fd', 2, 46)}
      {flakes(1, 52)}
    </>
  ),
  snow: () => (
    <>
      <Cloud />
      {flakes(3, 50)}
    </>
  ),
  'snow-heavy': () => (
    <>
      <Cloud />
      {flakes(3, 48)}
      {flakes(2, 57)}
    </>
  ),
  storm: () => (
    <>
      <Cloud />
      <Bolt />
    </>
  ),
  'storm-hail': () => (
    <>
      <Cloud />
      <Bolt />
      <circle cx={22} cy={52} r={2.5} fill="#e0f2fe" />
      <circle cx={46} cy={54} r={2.5} fill="#e0f2fe" />
    </>
  ),
};

export default function WeatherIcon({ icon = 'cloud', size = 48, className = '', title }) {
  const uid = useId().replace(/:/g, '');
  const shape = SHAPES[icon] || SHAPES.cloud;
  return (
    <svg
      viewBox="0 0 64 72"
      width={size}
      height={size}
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      {shape(uid)}
    </svg>
  );
}
