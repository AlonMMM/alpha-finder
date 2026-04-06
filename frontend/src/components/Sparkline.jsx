const W = 80, H = 28;

function points(data, w = W, h = H) {
  if (!data || data.length < 2) return '';
  const mn = Math.min(...data), mx = Math.max(...data), rng = mx - mn || 1;
  return data.map((p, i) =>
    `${(i / (data.length - 1) * w).toFixed(1)},${(h - (p - mn) / rng * h).toFixed(1)}`
  ).join(' ');
}

export function PriceSparkline({ history }) {
  if (!history?.length) return <span className="text-slate-600 text-xs">—</span>;
  const up    = history[history.length - 1] >= history[0];
  const color = up ? '#34d399' : '#f87171';
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <polyline points={points(history)} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function RatioSparkline({ tickerPrices, tickerDates, spyHistory }) {
  if (!tickerPrices?.length || !spyHistory?.prices?.length)
    return <span className="text-slate-600 text-xs">—</span>;

  const spyMap = {};
  spyHistory.dates.forEach((d, i) => { spyMap[d] = spyHistory.prices[i]; });
  const ratios = tickerDates
    .map((d, i) => (spyMap[d] ? tickerPrices[i] / spyMap[d] : null))
    .filter(Boolean);

  if (ratios.length < 2) return <span className="text-slate-600 text-xs">—</span>;

  const rising = ratios[ratios.length - 1] >= ratios[0];
  const color  = rising ? '#a78bfa' : '#fb923c';
  const mn = Math.min(...ratios), rng = (Math.max(...ratios) - mn) || 0.001;
  const y0 = H - (ratios[0] - mn) / rng * H;
  const y1 = H - (ratios[ratios.length - 1] - mn) / rng * H;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <line x1="0" y1={y0.toFixed(1)} x2={W} y2={y1.toFixed(1)}
        stroke={color} strokeWidth="0.8" strokeDasharray="3,2" opacity="0.5" />
      <polyline points={points(ratios)} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
