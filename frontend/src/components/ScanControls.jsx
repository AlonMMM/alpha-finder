import { useState } from 'react';

const inputCls = 'bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 w-full';

export default function ScanControls({ running, onStart, onStop, progress }) {
  const [params, setParams] = useState({
    lookback:  30,
    min_price: 5,
    min_cap:   500_000_000,
    min_beta:  0,
    sample:    0,
    workers:   10,
  });

  const set = (k) => (e) => setParams(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5">
      <h2 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">
        Scanner Parameters
      </h2>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-5">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">Lookback (days)</span>
          <input type="number" className={inputCls} value={params.lookback} min={7} max={90} onChange={set('lookback')} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">Min Price ($)</span>
          <input type="number" className={inputCls} value={params.min_price} min={1} onChange={set('min_price')} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">Min Market Cap</span>
          <select className={inputCls} value={params.min_cap} onChange={set('min_cap')}>
            <option value={100_000_000}>$100M+</option>
            <option value={250_000_000}>$250M+</option>
            <option value={500_000_000}>$500M+</option>
            <option value={1_000_000_000}>$1B+</option>
            <option value={5_000_000_000}>$5B+</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">Min Beta</span>
          <input type="number" className={inputCls} value={params.min_beta} min={0} max={3} step={0.1} onChange={set('min_beta')} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">Sample (0 = all)</span>
          <input type="number" className={inputCls} value={params.sample} min={0} step={100} onChange={set('sample')} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">Workers</span>
          <input type="number" className={inputCls} value={params.workers} min={1} max={30} onChange={set('workers')} />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => onStart(params)}
          disabled={running}
          className="bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition-colors"
        >
          ▶ Run Scan
        </button>
        <button
          onClick={onStop}
          disabled={!running}
          className="bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition-colors"
        >
          ■ Stop
        </button>

        {running && (
          <div className="flex-1">
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span>{progress.label}</span>
              <span>{progress.pct}%</span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                style={{ width: `${progress.pct}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
