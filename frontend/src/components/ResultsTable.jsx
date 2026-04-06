import { useState, useMemo, useCallback } from 'react';
import { fmtPct, fmtMC, fmtNum, tierConfig } from '../utils/format';
import { PriceSparkline, RatioSparkline } from './Sparkline';
import ChartPopup from './ChartPopup';

const COLS = [
  { key: 'ticker',           label: 'Ticker',      align: 'left' },
  { key: 'name',             label: 'Name',         align: 'left' },
  { key: 'sector',           label: 'Sector',       align: 'left' },
  { key: 'alpha_divergence', label: 'Alpha Div ↕',  align: 'right', title: 'How much the stock beat its beta-adjusted expected return' },
  { key: 'pct_change_30d',   label: '30d Return',   align: 'right' },
  { key: 'expected_return',  label: 'Expected',     align: 'right', title: 'Beta × SPY — what the stock was expected to do' },
  { key: 'beta',             label: 'Beta',         align: 'right' },
  { key: 'rs_slope',         label: 'RS Slope',     align: 'right', title: 'Slope of Ticker/SPY ratio — positive = strengthening' },
  { key: 'current_price',    label: 'Price',        align: 'right' },
  { key: 'market_cap',       label: 'Mkt Cap',      align: 'right' },
  { key: 'pe_ratio',         label: 'P/E',          align: 'right' },
  { key: 'revenue_growth',   label: 'Rev Growth',   align: 'right' },
  { key: 'rs_tier',          label: 'Tier',         align: 'left' },
];

function TierBadge({ tier }) {
  const cfg = tierConfig[tier] || { cls: 'bg-slate-700 text-slate-300', label: tier };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.cls}`}>{cfg.label}</span>;
}

function CellValue({ col, row }) {
  const v = row[col.key];
  switch (col.key) {
    case 'ticker':
      return <span className="font-mono font-bold text-indigo-300">{v}</span>;
    case 'name':
      return <span className="text-slate-300 text-xs truncate max-w-[160px] block" title={v}>{(v || '—').substring(0, 28)}</span>;
    case 'sector':
      return <span className="text-slate-400 text-xs">{v || '—'}</span>;
    case 'alpha_divergence':
      return <span className={`font-semibold tabular-nums ${v >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPct(v)}</span>;
    case 'pct_change_30d':
      return <span className={`tabular-nums ${v >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPct(v)}</span>;
    case 'expected_return':
      return <span className="tabular-nums text-red-400/80">{fmtPct(v)}</span>;
    case 'beta':
      return <span className="tabular-nums text-slate-300">{fmtNum(v)}</span>;
    case 'rs_slope':
      return <span className="tabular-nums text-slate-400 text-xs">{fmtNum(v, 5)}</span>;
    case 'current_price':
      return <span className="tabular-nums text-white">${fmtNum(v)}</span>;
    case 'market_cap':
      return <span className="tabular-nums text-slate-300 text-xs">{fmtMC(v)}</span>;
    case 'pe_ratio':
      return <span className="tabular-nums text-slate-400 text-xs">{v != null ? fmtNum(v, 1) : '—'}</span>;
    case 'revenue_growth':
      return <span className="tabular-nums text-purple-400 text-xs">{v != null ? `${(v * 100).toFixed(0)}%` : '—'}</span>;
    case 'rs_tier':
      return <TierBadge tier={v} />;
    default:
      return <span>{v ?? '—'}</span>;
  }
}

export default function ResultsTable({ tickers, spyHistory }) {
  const [sortKey, setSortKey]       = useState('alpha_divergence');
  const [sortAsc, setSortAsc]       = useState(false);
  const [search,  setSearch]        = useState('');
  const [sector,  setSector]        = useState('');
  const [tier,    setTier]          = useState('');
  const [popup,   setPopup]         = useState({ ticker: null, position: { x: 0, y: 0 } });

  const sectors = useMemo(() =>
    [...new Set(tickers.map(t => t.sector).filter(Boolean))].sort()
  , [tickers]);

  const sorted = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = tickers.filter(t =>
      (!q      || t.ticker.toLowerCase().includes(q) || (t.name || '').toLowerCase().includes(q)) &&
      (!sector || t.sector === sector) &&
      (!tier   || t.rs_tier === tier)
    );
    return [...filtered].sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey];
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return sortAsc ? cmp : -cmp;
    });
  }, [tickers, search, sector, tier, sortKey, sortAsc]);

  const handleSort = (key) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  };

  const handleMouseEnter = useCallback((e, ticker) => {
    const pw = 320, ph = 300;
    let x = e.clientX + 16, y = e.clientY - 20;
    if (x + pw > window.innerWidth)  x = e.clientX - pw - 16;
    if (y + ph > window.innerHeight) y = window.innerHeight - ph - 10;
    setPopup({ ticker, position: { x, y } });
  }, []);

  const handleMouseMove = useCallback((e) => {
    const pw = 320, ph = 300;
    let x = e.clientX + 16, y = e.clientY - 20;
    if (x + pw > window.innerWidth)  x = e.clientX - pw - 16;
    if (y + ph > window.innerHeight) y = window.innerHeight - ph - 10;
    setPopup(p => p.ticker ? { ...p, position: { x, y } } : p);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setPopup({ ticker: null, position: { x: 0, y: 0 } });
  }, []);

  const inputCls = 'bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500';

  return (
    <>
      <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Results</h2>
          <input className={`${inputCls} ml-auto w-48`} placeholder="Search ticker / name…"
            value={search} onChange={e => setSearch(e.target.value)} />
          <select className={inputCls} value={sector} onChange={e => setSector(e.target.value)}>
            <option value="">All Sectors</option>
            {sectors.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className={inputCls} value={tier} onChange={e => setTier(e.target.value)}>
            <option value="">All Tiers</option>
            <option value="STRONG">STRONG</option>
            <option value="OUTPERFORMER">OUTPERFORMER</option>
            <option value="RELATIVE_ONLY">RELATIVE ONLY</option>
          </select>
          <span className="text-sm text-slate-500 tabular-nums">{sorted.length} results</span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-3 py-2 text-left">#</th>
                {COLS.map(col => (
                  <th key={col.key}
                    className={`px-3 py-2 text-${col.align} cursor-pointer hover:bg-slate-800 select-none whitespace-nowrap`}
                    title={col.title}
                    onClick={() => handleSort(col.key)}
                  >
                    {col.label}
                    {sortKey === col.key && (
                      <span className="text-indigo-400 ml-1">{sortAsc ? '↑' : '↓'}</span>
                    )}
                  </th>
                ))}
                <th className="px-3 py-2 text-left" title="Hover for detailed chart">Price Chart</th>
                <th className="px-3 py-2 text-left" title="Ticker/SPY ratio — purple=rising, orange=fading">RS Ratio</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t, i) => (
                <tr key={t.ticker}
                  className="border-b border-slate-800 hover:bg-slate-800/40 transition-colors">
                  <td className="px-3 py-2 text-slate-500 tabular-nums text-xs">{i + 1}</td>
                  {COLS.map(col => (
                    <td key={col.key} className={`px-3 py-2 text-${col.align}`}>
                      <CellValue col={col} row={t} />
                    </td>
                  ))}
                  <td className="px-3 py-2 cursor-pointer"
                    onMouseEnter={e => handleMouseEnter(e, t)}
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}>
                    <PriceSparkline history={t.price_history} />
                  </td>
                  <td className="px-3 py-2 cursor-pointer"
                    onMouseEnter={e => handleMouseEnter(e, t)}
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}>
                    <RatioSparkline
                      tickerPrices={t.price_history}
                      tickerDates={t.price_dates}
                      spyHistory={spyHistory}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ChartPopup ticker={popup.ticker} position={popup.position} spyHistory={spyHistory} />
    </>
  );
}
