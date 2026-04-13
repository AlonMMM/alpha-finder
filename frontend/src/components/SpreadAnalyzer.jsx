import { useState, useCallback } from 'react';

const fmt  = (v, d = 2) => v != null ? Number(v).toFixed(d) : '—';
const fmtX = (v)        => v != null ? `${Number(v).toFixed(1)}X` : '—';

const inputCls = 'bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500';

const RETURN_COLORS = (x) => {
  if (x >= 10) return 'text-emerald-400 font-bold';
  if (x >= 8)  return 'text-green-400 font-semibold';
  if (x >= 6)  return 'text-yellow-400';
  return 'text-slate-300';
};

const PRICE_OPTS = [
  { value: 'ask',  label: 'Ask (worst case)' },
  { value: 'mid',  label: 'Mid' },
  { value: 'last', label: 'Last' },
  { value: 'bid',  label: 'Bid (best case)' },
];

const STRATEGIES = [
  {
    value: 'bull_call',
    label: 'Bull Call Spread',
    desc:  'Buy lower call · Sell higher call · Profit if price rises',
    color: 'text-emerald-400',
    bg:    'bg-emerald-950/40 border-emerald-700',
    inactive: 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600',
  },
  {
    value: 'bear_put',
    label: 'Bear Put Spread',
    desc:  'Buy higher put · Sell lower put · Profit if price falls',
    color: 'text-rose-400',
    bg:    'bg-rose-950/40 border-rose-700',
    inactive: 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600',
  },
];

export default function SpreadAnalyzer({ ibAuth }) {
  const isAuthed = ibAuth?.authenticated && ibAuth?.connected;

  const [strategy,    setStrategy]    = useState('bull_call');
  const [symbol,      setSymbol]      = useState('MCL');
  const [symbolInfo,  setSymbolInfo]  = useState(null);
  const [month,       setMonth]       = useState('');
  const [expirations, setExpirations] = useState([]);
  const [expDate,     setExpDate]     = useState('');
  const [otmOnly,     setOtmOnly]     = useState(true);
  const [buyPrice,    setBuyPrice]    = useState('ask');
  const [sellPrice,   setSellPrice]   = useState('bid');
  const [minReturn,   setMinReturn]   = useState(6);
  const [maxReturn,   setMaxReturn]   = useState(12);
  const [minDebit,    setMinDebit]    = useState(0.05);
  const [maxDebit,    setMaxDebit]    = useState(5);
  const [results,     setResults]     = useState(null);
  const [sortCol,     setSortCol]     = useState('return_x');
  const [sortAsc,     setSortAsc]     = useState(false);
  const [loading,     setLoading]     = useState('');
  const [error,       setError]       = useState(null);

  const strat = STRATEGIES.find(s => s.value === strategy);

  // Load expirations for a given month + conid
  const fetchExpirations = useCallback(async (m, info) => {
    if (!m || !info) return;
    setLoading('expirations');
    setExpirations([]);
    setExpDate('');
    const p = new URLSearchParams({ month: m, conid: info.search_conid,
                                    sectype: info.sectype, exchange: info.exchange });
    try {
      const r = await fetch(`/api/ib/expirations?${p}`);
      const d = await r.json();
      if (!r.ok) { setError(d.error); return; }
      const exps = d.expirations || [];
      setExpirations(exps);
      if (exps.length) setExpDate(exps[0]);
    } catch (e) { setError(e.message); }
    finally { setLoading(''); }
  }, [symbol]);

  // Step 1: load symbol + auto-load expirations for first month
  const loadSymbol = useCallback(async () => {
    setLoading('symbol');
    setError(null);
    setSymbolInfo(null);
    setMonth('');
    setExpirations([]);
    setExpDate('');
    setResults(null);
    try {
      const r = await fetch(`/api/ib/symbol-info?symbol=${symbol}`);
      const d = await r.json();
      if (!r.ok) { setError(d.error); return; }
      setSymbolInfo(d);
      const firstMonth = d.opt_months?.[0];
      if (firstMonth) {
        setMonth(firstMonth);
        await fetchExpirations(firstMonth, d);
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(''); }
  }, [symbol, fetchExpirations]);

  const onMonthChange = (m) => {
    setMonth(m);
    if (symbolInfo) fetchExpirations(m, symbolInfo);
  };

  // Step 2: run spread analysis
  const analyze = useCallback(async () => {
    if (!symbolInfo || !month || !expDate) return;
    setLoading('analyze');
    setError(null);
    setResults(null);
    const params = new URLSearchParams({
      symbol,
      month,
      exp_date:   expDate,
      conid:      symbolInfo.search_conid,
      sectype:    symbolInfo.sectype,
      exchange:   symbolInfo.exchange,
      is_future:  symbolInfo.is_future,
      strategy,
      otm_only:   otmOnly,
      min_return: minReturn,
      max_return: maxReturn,
      min_debit:  minDebit,
      max_debit:  maxDebit,
      buy_price:  buyPrice,
      sell_price: sellPrice,
    });
    try {
      const r = await fetch(`/api/spreads?${params}`);
      const d = await r.json();
      if (!r.ok) { setError(d.error); return; }
      setResults(d);
    } catch (e) { setError(e.message); }
    finally { setLoading(''); }
  }, [symbol, symbolInfo, month, expDate, strategy, minReturn, maxReturn,
      minDebit, maxDebit, buyPrice, sellPrice, otmOnly]);

  const toggleSort = (col) => {
    if (sortCol === col) setSortAsc(a => !a);
    else { setSortCol(col); setSortAsc(false); }
  };

  const sorted = results?.spreads
    ? [...results.spreads].sort((a, b) =>
        sortAsc ? a[sortCol] - b[sortCol] : b[sortCol] - a[sortCol]
      )
    : [];

  const SortTh = ({ col, label, right }) => (
    <th
      onClick={() => toggleSort(col)}
      className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide cursor-pointer select-none
        hover:text-white transition-colors ${right ? 'text-right' : 'text-left'}
        ${sortCol === col ? 'text-indigo-400' : 'text-slate-400'}`}
    >
      {label}{sortCol === col ? (sortAsc ? ' ↑' : ' ↓') : ''}
    </th>
  );

  const isBull = strategy === 'bull_call';

  return (
    <div className="space-y-4">
      {/* ── Controls ── */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 space-y-4">

        {/* Strategy picker */}
        <div className="flex gap-3">
          {STRATEGIES.map(s => (
            <button
              key={s.value}
              onClick={() => { setStrategy(s.value); setResults(null); }}
              className={`flex-1 text-left px-4 py-3 rounded-xl border transition-colors ${
                strategy === s.value ? s.bg + ' ' + s.color : s.inactive
              }`}
            >
              <div className="font-semibold text-sm">{s.label}</div>
              <div className="text-xs mt-0.5 opacity-70">{s.desc}</div>
            </button>
          ))}
        </div>

        {/* Row 1: Symbol */}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-400">Symbol</span>
            <input
              className={inputCls + ' w-28 uppercase'}
              value={symbol}
              onChange={e => setSymbol(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && loadSymbol()}
            />
          </label>
          <button
            onClick={loadSymbol}
            disabled={!!loading}
            className="bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {loading === 'symbol' ? 'Loading…' : 'Load'}
          </button>
          {!isAuthed && (
            <span className="text-xs text-amber-600 self-end pb-2">
              IBKR not connected —{' '}
              <a href="https://localhost:5055" target="_blank" rel="noreferrer" className="underline hover:text-amber-400">login first</a>
            </span>
          )}
          {symbolInfo && (
            <span className="text-xs text-slate-400 self-end pb-2">
              Underlying @ <span className="text-white font-mono font-semibold">${symbolInfo.und_price}</span>
              &nbsp;·&nbsp;
              <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
                symbolInfo.is_future ? 'bg-amber-900/50 text-amber-400' : 'bg-sky-900/50 text-sky-400'
              }`}>
                {symbolInfo.is_future ? 'FUTURES' : 'EQUITY'}
              </span>
              &nbsp;·&nbsp;{symbolInfo.opt_months.length} months
            </span>
          )}
        </div>

        {/* Row 2: Month + Expiry */}
        {symbolInfo && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-400">Month</span>
              <select
                className={inputCls + ' w-36'}
                value={month}
                onChange={e => onMonthChange(e.target.value)}
                disabled={loading === 'expirations'}
              >
                {symbolInfo.opt_months.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-400">Expiry Date</span>
              <select
                className={inputCls + ' w-36'}
                value={expDate}
                onChange={e => setExpDate(e.target.value)}
                disabled={loading === 'expirations' || !expirations.length}
              >
                {loading === 'expirations'
                  ? <option>Loading…</option>
                  : expirations.length
                    ? expirations.map(d => <option key={d} value={d}>{d}</option>)
                    : <option>— select month first —</option>
                }
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-400">Strikes</span>
              <select className={inputCls + ' w-36'} value={otmOnly} onChange={e => setOtmOnly(e.target.value === 'true')}>
                <option value="true">OTM only</option>
                <option value="false">All strikes</option>
              </select>
            </label>
          </div>
        )}

        {/* Row 3: Spread params */}
        {symbolInfo && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-400">Min Return</span>
              <input type="number" className={inputCls + ' w-24'} value={minReturn}
                min={1} step={0.5} onChange={e => setMinReturn(+e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-400">Max Return</span>
              <input type="number" className={inputCls + ' w-24'} value={maxReturn}
                min={1} step={0.5} onChange={e => setMaxReturn(+e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-400">Min Debit ($)</span>
              <input type="number" className={inputCls + ' w-24'} value={minDebit}
                min={0.01} step={0.05} onChange={e => setMinDebit(+e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-400">Max Debit ($)</span>
              <input type="number" className={inputCls + ' w-24'} value={maxDebit}
                min={0.1} step={0.5} onChange={e => setMaxDebit(+e.target.value)} />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-400">Buy (long) price</span>
              <select className={inputCls + ' w-40'} value={buyPrice} onChange={e => setBuyPrice(e.target.value)}>
                {PRICE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-400">Sell (short) price</span>
              <select className={inputCls + ' w-40'} value={sellPrice} onChange={e => setSellPrice(e.target.value)}>
                {PRICE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>

            <button
              onClick={analyze}
              disabled={!expDate || loading === 'analyze'}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed
                text-white font-semibold px-6 py-2 rounded-xl text-sm transition-colors self-end"
            >
              {loading === 'analyze'
                ? <span className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Analyzing…
                  </span>
                : '⚡ Analyze Spreads'}
            </button>
          </div>
        )}

        {error && (
          <div className="bg-red-950/50 border border-red-800 rounded-lg px-4 py-2 text-red-400 text-sm">
            {error}
          </div>
        )}
      </div>

      {/* ── Results ── */}
      {results && (
        <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-200">
              <span className={strat.color}>{strat.label}</span>
              &nbsp;·&nbsp;{results.count} spreads
              &nbsp;·&nbsp;{symbol} @ <span className="text-white font-mono">${results.und_price}</span>
              &nbsp;·&nbsp;exp <span className="text-indigo-400">{results.exp_date}</span>
              &nbsp;·&nbsp;buy:<span className="text-slate-300"> {buyPrice}</span>
              &nbsp;/&nbsp;sell:<span className="text-slate-300"> {sellPrice}</span>
            </span>
            <span className="text-xs text-slate-500">Click column to sort</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-700 bg-slate-800/50">
                <tr>
                  <SortTh col="buy_strike"  label={isBull ? 'Buy Call' : 'Buy Put'} />
                  <SortTh col="sell_strike" label={isBull ? 'Sell Call' : 'Sell Put'} />
                  <SortTh col="width"       label="Width"      right />
                  <SortTh col="net_debit"   label="Debit"      right />
                  <SortTh col="max_profit"  label="Max Profit" right />
                  <SortTh col="breakeven"   label="Breakeven"  right />
                  <SortTh col="return_x"    label="Return"     right />
                  <SortTh col="buy_iv"      label="IV%"        right />
                  <SortTh col="buy_delta"   label="Δ"          right />
                  <SortTh col="buy_volume"  label="Vol"        right />
                  <th className="px-3 py-2 text-xs text-slate-400 text-right">Buy bid/ask</th>
                  <th className="px-3 py-2 text-xs text-slate-400 text-right">Sell bid/ask</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => (
                  <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/40 transition-colors">
                    <td className="px-3 py-2 font-mono text-slate-200">{r.buy_strike}</td>
                    <td className="px-3 py-2 font-mono text-slate-200">{r.sell_strike}</td>
                    <td className="px-3 py-2 text-right text-slate-400">${fmt(r.width)}</td>
                    <td className="px-3 py-2 text-right font-mono text-red-400">${fmt(r.net_debit, 3)}</td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-400">${fmt(r.max_profit, 3)}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300">${fmt(r.breakeven, 2)}</td>
                    <td className={`px-3 py-2 text-right font-mono ${RETURN_COLORS(r.return_x)}`}>
                      {fmtX(r.return_x)}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-400">{r.buy_iv != null ? `${r.buy_iv}%` : '—'}</td>
                    <td className="px-3 py-2 text-right text-cyan-400">{fmt(r.buy_delta, 3)}</td>
                    <td className="px-3 py-2 text-right text-slate-400">{r.buy_volume ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-slate-400 font-mono text-xs">
                      {r.buy_bid != null ? `${fmt(r.buy_bid,2)} / ${fmt(r.buy_ask,2)}` : `@ ${fmt(r.buy_price,3)}`}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-400 font-mono text-xs">
                      {r.sell_bid != null ? `${fmt(r.sell_bid,2)} / ${fmt(r.sell_ask,2)}` : `@ ${fmt(r.sell_price,3)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
