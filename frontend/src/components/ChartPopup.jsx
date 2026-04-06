import { useState } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, Title, Tooltip, Legend, Filler,
} from 'chart.js';
import { fmtPct, tierConfig } from '../utils/format';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler);

const TABS = ['price', 'ratio', 'volume'];

const baseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 200 },
  plugins: {
    legend: { labels: { color: '#94a3b8', font: { size: 10 } } },
    tooltip: {
      backgroundColor: '#1e293b', titleColor: '#e2e8f0',
      bodyColor: '#94a3b8', borderColor: '#334155', borderWidth: 1,
    },
  },
  scales: {
    x: { display: false },
    y: { ticks: { color: '#64748b', font: { size: 9 } }, grid: { color: '#1e293b' } },
  },
};

function buildPriceData(t, spyMap) {
  const p0 = t.price_history?.[0] || 1;
  const s0 = t.price_dates?.map(d => spyMap[d]).find(v => v) || 1;
  return {
    labels: t.price_dates || [],
    datasets: [
      { label: t.ticker, data: (t.price_history || []).map(p => p ? +(p / p0 * 100).toFixed(2) : null),
        borderColor: '#818cf8', borderWidth: 2, pointRadius: 0, tension: 0.3, fill: false },
      { label: 'SPY', data: (t.price_dates || []).map(d => spyMap[d] ? +(spyMap[d] / s0 * 100).toFixed(2) : null),
        borderColor: '#94a3b8', borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: false, borderDash: [4, 3] },
    ],
  };
}

function buildRatioData(t, spyMap) {
  const ratios = (t.price_dates || []).map((d, i) => {
    const spy = spyMap[d];
    return spy && t.price_history?.[i] ? +((t.price_history[i] / spy).toFixed(4)) : null;
  });
  const valid = ratios.map((r, i) => r != null ? { x: i, y: r } : null).filter(Boolean);
  let trend = ratios.map(() => null);
  if (valid.length >= 2) {
    const n  = valid.length;
    const mx = valid.reduce((s, p) => s + p.x, 0) / n;
    const my = valid.reduce((s, p) => s + p.y, 0) / n;
    const sl = valid.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) /
               valid.reduce((s, p) => s + (p.x - mx) ** 2, 0);
    const b  = my - sl * mx;
    trend = ratios.map((r, i) => r != null ? +((sl * i + b).toFixed(4)) : null);
  }
  return {
    labels: t.price_dates || [],
    datasets: [
      { label: 'RS Ratio', data: ratios, borderColor: '#a78bfa', borderWidth: 2,
        pointRadius: 0, tension: 0.3, fill: { target: 'origin', above: 'rgba(167,139,250,0.08)' } },
      { label: 'Trend', data: trend, borderColor: '#f472b6', borderWidth: 1.5,
        pointRadius: 0, borderDash: [5, 3], fill: false },
    ],
  };
}

function buildVolumeData(t) {
  const avgVol = t.avg_volume ? (t.avg_volume / 1e6).toFixed(2) : null;
  return {
    labels: t.price_dates || [],
    datasets: [
      { label: 'Volume (M)', data: (t.price_dates || []).map(() => null),
        backgroundColor: 'rgba(99,102,241,0.5)', borderColor: '#6366f1', borderWidth: 1 },
      ...(avgVol ? [{ label: 'Avg Vol', data: (t.price_dates || []).map(() => parseFloat(avgVol)),
        type: 'line', borderColor: '#f59e0b', borderWidth: 1.5, pointRadius: 0, borderDash: [4, 3] }] : []),
    ],
  };
}

export default function ChartPopup({ ticker, position, spyHistory }) {
  const [tab, setTab] = useState('price');

  if (!ticker) return null;

  const spyMap = {};
  (spyHistory?.dates || []).forEach((d, i) => { spyMap[d] = spyHistory.prices[i]; });

  const chartData = tab === 'price'  ? buildPriceData(ticker, spyMap)
                  : tab === 'ratio'  ? buildRatioData(ticker, spyMap)
                  : buildVolumeData(ticker);

  const cfg = tierConfig[ticker.rs_tier] || { cls: 'bg-slate-700 text-slate-300', label: ticker.rs_tier };

  return (
    <div
      className="fixed z-50 w-80 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-4 pointer-events-none"
      style={{ left: position.x, top: position.y }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="font-mono font-bold text-indigo-300 text-lg">{ticker.ticker}</span>
          <span className="text-slate-400 text-xs ml-2">{(ticker.name || '').substring(0, 20)}</span>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.cls}`}>{cfg.label}</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-3">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-1 rounded-lg text-xs font-semibold pointer-events-auto transition-colors
              ${tab === t ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
            {t === 'price' ? 'Price vs SPY' : t === 'ratio' ? 'RS Ratio' : 'Volume'}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="h-44 relative">
        {tab === 'volume'
          ? <Bar data={chartData} options={baseOptions} />
          : <Line data={chartData} options={baseOptions} />
        }
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mt-3 text-center">
        <div className="bg-slate-800 rounded-lg py-1.5">
          <div className="text-slate-400 text-xs">Alpha Div</div>
          <div className="font-bold text-sm text-emerald-400">{fmtPct(ticker.alpha_divergence)}</div>
        </div>
        <div className="bg-slate-800 rounded-lg py-1.5">
          <div className="text-slate-400 text-xs">Beta</div>
          <div className="font-bold text-sm text-slate-200">{(ticker.beta || 0).toFixed(2)}</div>
        </div>
        <div className="bg-slate-800 rounded-lg py-1.5">
          <div className="text-slate-400 text-xs">RS Slope</div>
          <div className="font-bold text-sm text-purple-400">{(ticker.rs_slope || 0).toFixed(5)}</div>
        </div>
      </div>
    </div>
  );
}
