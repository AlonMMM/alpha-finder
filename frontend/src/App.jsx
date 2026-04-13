import { useState, useEffect, useCallback } from 'react';
import Header         from './components/Header';
import ScanControls   from './components/ScanControls';
import LogTerminal    from './components/LogTerminal';
import StatsBar       from './components/StatsBar';
import ResultsTable   from './components/ResultsTable';
import SpreadAnalyzer from './components/SpreadAnalyzer';
import useScan        from './hooks/useScan';

const TABS = ['Scanner', 'Spreads'];

export default function App() {
  const [tab,     setTab]     = useState('Scanner');
  const [results, setResults] = useState(null);
  const [logs,    setLogs]    = useState([]);
  const [ibAuth,  setIbAuth]  = useState(null);

  // Single IBKR auth poll — shared across all tabs
  useEffect(() => {
    const check = () =>
      fetch('/api/ib/status').then(r => r.json()).then(setIbAuth).catch(() => setIbAuth(null));
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, []);

  const fetchResults = useCallback(() => {
    fetch('/api/results')
      .then(r => r.json())
      .then(data => { if (data.tickers?.length) setResults(data); });
  }, []);

  useEffect(() => { fetchResults(); }, [fetchResults]);

  const { running, status, progress, start, stop } = useScan({
    onLog:       (line) => setLogs(prev => [...prev, line]),
    onDone:      fetchResults,
    onClearLogs: () => setLogs([]),
  });

  return (
    <div className="bg-slate-950 text-slate-100 min-h-screen">
      <Header status={status} ibAuth={ibAuth} />

      {/* Tab bar */}
      <div className="border-b border-slate-800 px-6">
        <div className="max-w-screen-2xl mx-auto flex gap-1">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === t
                  ? 'border-indigo-500 text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-screen-2xl mx-auto px-6 py-6 space-y-6">
        {tab === 'Scanner' && (
          <>
            <ScanControls running={running} progress={progress} onStart={start} onStop={stop} />
            <LogTerminal  logs={logs} onClear={() => setLogs([])} />
            {results && (
              <>
                <StatsBar data={results} />
                <ResultsTable
                  tickers={results.tickers}
                  spyHistory={results.spy_history || { dates: [], prices: [] }}
                />
              </>
            )}
          </>
        )}

        {tab === 'Spreads' && <SpreadAnalyzer ibAuth={ibAuth} />}
      </div>
    </div>
  );
}
