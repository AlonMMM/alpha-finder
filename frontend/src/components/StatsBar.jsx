import { fmtPct } from '../utils/format';

function Stat({ label, value, cls }) {
  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 p-3 text-center">
      <div className="text-slate-400 text-xs mb-1">{label}</div>
      <div className={`font-bold text-lg ${cls}`}>{value}</div>
    </div>
  );
}

export default function StatsBar({ data }) {
  if (!data) return null;

  const avg = data.tickers.length
    ? data.tickers.reduce((s, t) => s + t.alpha_divergence, 0) / data.tickers.length
    : 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      <Stat label="SPY 30d"      value={fmtPct(data.spy_return)}  cls={data.spy_return >= 0 ? 'text-emerald-400' : 'text-red-400'} />
      <Stat label="Winners"      value={data.total_winners}        cls="text-emerald-400" />
      <Stat label="STRONG"       value={data.tickers.filter(t => t.rs_tier === 'STRONG').length}       cls="text-emerald-500" />
      <Stat label="OUTPERFORMER" value={data.tickers.filter(t => t.rs_tier === 'OUTPERFORMER').length} cls="text-blue-400" />
      <Stat label="Avg Alpha Div" value={fmtPct(avg)}              cls="text-indigo-400" />
    </div>
  );
}
