import { useState, useEffect, useCallback } from 'react';
import Header       from './components/Header';
import ScanControls from './components/ScanControls';
import LogTerminal  from './components/LogTerminal';
import StatsBar     from './components/StatsBar';
import ResultsTable from './components/ResultsTable';
import useScan      from './hooks/useScan';

export default function App() {
  const [results, setResults] = useState(null);
  const [logs,    setLogs]    = useState([]);

  const fetchResults = useCallback(() => {
    fetch('/api/results')
      .then(r => r.json())
      .then(data => { if (data.tickers?.length) setResults(data); });
  }, []);

  useEffect(() => { fetchResults(); }, [fetchResults]);

  const { running, status, progress, start, stop } = useScan({
    onLog:  (line) => setLogs(prev => [...prev, line]),
    onDone: fetchResults,
  });

  return (
    <div className="bg-slate-950 text-slate-100 min-h-screen">
      <Header status={status} />

      <div className="max-w-screen-2xl mx-auto px-6 py-6 space-y-6">
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
      </div>
    </div>
  );
}
