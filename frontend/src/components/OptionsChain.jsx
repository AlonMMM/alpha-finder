import { useState, useMemo } from 'react';

const fmt = (v, d = 2) => v != null ? Number(v).toFixed(d) : '—';
const fmtPct = (v) => v != null ? `${Number(v).toFixed(1)}%` : '—';

export default function OptionsChain({ ibAuth }) {
  const [expiry,      setExpiry]      = useState('');
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [data,        setData]        = useState(null);
  const [strikeRange, setStrikeRange] = useState(20);

  const isAuthed = ibAuth?.authenticated && ibAuth?.connected;

  const fetch_chain = async () => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const params = new URLSearchParams({});
      if (expiry) params.set('expiry', expiry);
      const res = await fetch(`/api/options?${params}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Unknown error');
      } else {
        setData(json);
        if (!expiry) setExpiry(json.expiry.slice(0, 6));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const { calls, puts, strikes } = useMemo(() => {
    if (!data) return { calls: {}, puts: {}, strikes: [] };
    const calls = {}, puts = {};
    for (const r of data.rows) {
      const key = r.strike;
      const obj = { bid: r.bid, ask: r.ask, last: r.last, mid: r.mid,
                    iv: r.iv, delta: r.delta, theta: r.theta,
                    vol: r.volume, oi: r.open_interest };
      if (r.type === 'call') calls[key] = obj;
      else                   puts[key]  = obj;
    }
    const allStrikes = [...new Set(data.rows.map(r => r.strike))].sort((a, b) => a - b);
    // Filter to ±N from ATM
    const atm  = data.und_price;
    const sorted = allStrikes.sort((a, b) => Math.abs(a - atm) - Math.abs(b - atm));
    const visible = new Set(sorted.slice(0, strikeRange * 2));
    return {
      calls,
      puts,
      strikes: allStrikes.filter(s => visible.has(s)),
    };
  }, [data, strikeRange]);

  const inputCls = 'bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500';

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
            MCL Options Chain — IB Client Portal
          </h2>
          <div className="flex items-center gap-3">
            {!isAuthed && (
              <a
                href="https://localhost:5055"
                target="_blank"
                rel="noreferrer"
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4 py-1.5 rounded-lg transition-colors"
              >
                Login with IBKR →
              </a>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-400">Expiry (YYYYMM)</span>
            <input
              className={inputCls + ' w-36'}
              placeholder="auto"
              value={expiry}
              onChange={e => setExpiry(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-400">Strikes ±ATM</span>
            <select className={inputCls} value={strikeRange} onChange={e => setStrikeRange(Number(e.target.value))}>
              <option value={10}>±10</option>
              <option value={20}>±20</option>
              <option value={30}>±30</option>
              <option value={9999}>All</option>
            </select>
          </label>
          <button
            onClick={fetch_chain}
            disabled={loading || !isAuthed}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-6 py-2 rounded-xl text-sm transition-colors"
          >
            {loading ? 'Loading…' : '⚡ Load Chain'}
          </button>
          {!isAuthed && (
            <span className="text-xs text-slate-500 self-end pb-2">
              Start CP Gateway first: <code className="text-slate-300">cd clientportal && bin/run.sh root/conf.yaml</code>
            </span>
          )}
          {data && (
            <span className="text-xs text-slate-400 self-end pb-2">
              MCL @ <span className="text-white font-mono">${data.und_price}</span>
              &nbsp;·&nbsp;exp <span className="text-indigo-400">{data.expiry}</span>
              &nbsp;·&nbsp;{data.rows.length} contracts
            </span>
          )}
        </div>
        {error && (
          <div className="mt-3 bg-red-950/50 border border-red-800 rounded-lg px-4 py-2 text-red-400 text-sm">
            {error}
          </div>
        )}
        {loading && (
          <div className="mt-3 flex items-center gap-2 text-slate-400 text-sm">
            <span className="inline-block w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            Fetching options chain from IBKR…
          </div>
        )}
      </div>

      {/* Chain table */}
      {data && strikes.length > 0 && (
        <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700">
                  {/* Calls header */}
                  <th colSpan={8} className="py-2 text-center text-indigo-400 font-semibold border-r border-slate-700 bg-indigo-950/20">
                    CALLS
                  </th>
                  {/* Strike */}
                  <th className="py-2 px-4 text-center text-white bg-slate-800 border-r border-slate-700 whitespace-nowrap">
                    Strike
                  </th>
                  {/* Puts header */}
                  <th colSpan={8} className="py-2 text-center text-rose-400 font-semibold bg-rose-950/20">
                    PUTS
                  </th>
                </tr>
                <tr className="border-b border-slate-700 text-slate-500 uppercase tracking-wide">
                  {/* Call columns (right-aligned) */}
                  <th className="px-3 py-1.5 text-right font-normal border-r border-slate-800">OI</th>
                  <th className="px-3 py-1.5 text-right font-normal">Vol</th>
                  <th className="px-3 py-1.5 text-right font-normal">IV%</th>
                  <th className="px-3 py-1.5 text-right font-normal">Δ</th>
                  <th className="px-3 py-1.5 text-right font-normal">Θ</th>
                  <th className="px-3 py-1.5 text-right font-normal">Bid</th>
                  <th className="px-3 py-1.5 text-right font-normal">Ask</th>
                  <th className="px-3 py-1.5 text-right font-normal border-r border-slate-700">Last</th>
                  {/* Strike */}
                  <th className="px-4 py-1.5 text-center font-semibold text-white bg-slate-800 border-r border-slate-700" />
                  {/* Put columns (left-aligned) */}
                  <th className="px-3 py-1.5 text-left font-normal">Last</th>
                  <th className="px-3 py-1.5 text-left font-normal">Bid</th>
                  <th className="px-3 py-1.5 text-left font-normal">Ask</th>
                  <th className="px-3 py-1.5 text-left font-normal">Δ</th>
                  <th className="px-3 py-1.5 text-left font-normal">Θ</th>
                  <th className="px-3 py-1.5 text-left font-normal">IV%</th>
                  <th className="px-3 py-1.5 text-left font-normal">Vol</th>
                  <th className="px-3 py-1.5 text-left font-normal">OI</th>
                </tr>
              </thead>
              <tbody>
                {strikes.map(strike => {
                  const call  = calls[strike] || {};
                  const put   = puts[strike]  || {};
                  const isAtm = Math.abs(strike - data.und_price) < (strikes[1] - strikes[0]) * 0.6;
                  return (
                    <tr
                      key={strike}
                      className={`border-b border-slate-800 text-xs ${isAtm ? 'ring-1 ring-inset ring-yellow-500/50' : ''}`}
                    >
                      {/* Call side */}
                      <td className="px-3 py-1.5 text-right text-slate-400 border-r border-slate-800">{fmt(call.oi, 0)}</td>
                      <td className="px-3 py-1.5 text-right text-slate-400">{fmt(call.vol, 0)}</td>
                      <td className="px-3 py-1.5 text-right text-slate-300">{fmtPct(call.iv)}</td>
                      <td className="px-3 py-1.5 text-right text-cyan-400">{fmt(call.delta, 3)}</td>
                      <td className="px-3 py-1.5 text-right text-slate-400">{fmt(call.theta, 3)}</td>
                      <td className="px-3 py-1.5 text-right text-emerald-400 font-mono">{fmt(call.bid)}</td>
                      <td className="px-3 py-1.5 text-right text-red-400 font-mono">{fmt(call.ask)}</td>
                      <td className="px-3 py-1.5 text-right text-white font-mono font-semibold border-r border-slate-700">{fmt(call.last)}</td>

                      {/* Strike */}
                      <td className={`px-4 py-1.5 text-center font-bold font-mono border-r border-slate-700 bg-slate-800 ${isAtm ? 'text-yellow-400' : 'text-slate-200'}`}>
                        {strike}
                      </td>

                      {/* Put side */}
                      <td className="px-3 py-1.5 text-left text-white font-mono font-semibold">{fmt(put.last)}</td>
                      <td className="px-3 py-1.5 text-left text-emerald-400 font-mono">{fmt(put.bid)}</td>
                      <td className="px-3 py-1.5 text-left text-red-400 font-mono">{fmt(put.ask)}</td>
                      <td className="px-3 py-1.5 text-left text-cyan-400">{fmt(put.delta, 3)}</td>
                      <td className="px-3 py-1.5 text-left text-slate-400">{fmt(put.theta, 3)}</td>
                      <td className="px-3 py-1.5 text-left text-slate-300">{fmtPct(put.iv)}</td>
                      <td className="px-3 py-1.5 text-left text-slate-400">{fmt(put.vol, 0)}</td>
                      <td className="px-3 py-1.5 text-left text-slate-400">{fmt(put.oi, 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
