import { useState, useRef, useCallback } from 'react';

export default function useScan({ onLog, onDone, onClearLogs }) {
  const [running,  setRunning]  = useState(false);
  const [status,   setStatus]   = useState('IDLE');
  const [progress, setProgress] = useState({ pct: 0, label: '' });
  const evtRef  = useRef(null);

  const parseProgress = useCallback((line) => {
    const bm = line.match(/Batch (\d+)\/(\d+)/);
    if (bm) {
      const pct = Math.round((parseInt(bm[1]) / parseInt(bm[2])) * 70);
      setProgress({ pct, label: `Downloading batch ${bm[1]}/${bm[2]}…` });
      return;
    }
    if (line.includes('Fetching fundamentals'))   setProgress({ pct: 75, label: 'Fetching fundamentals…' });
    if (line.includes('Winners after market-cap')) setProgress({ pct: 95, label: 'Applying market cap filter…' });
    if (line.includes('SCAN COMPLETE'))            setProgress({ pct: 100, label: 'Complete!' });
  }, []);

  const start = useCallback(async (params) => {
    onClearLogs?.();
    setProgress({ pct: 0, label: 'Starting…' });
    setRunning(true);
    setStatus('RUNNING');

    await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (evtRef.current) evtRef.current.close();
    const es = new EventSource('/api/stream');
    evtRef.current = es;

    es.addEventListener('log', (e) => {
      onLog?.(e.data);
      parseProgress(e.data);
    });

    es.addEventListener('done', () => {
      es.close();
      setRunning(false);
      setStatus('DONE');
      onDone();
    });

    es.addEventListener('error_end', () => {
      es.close();
      setRunning(false);
      setStatus('ERROR');
    });
  }, [parseProgress, onDone, onClearLogs]);

  const stop = useCallback(() => {
    fetch('/api/stop', { method: 'POST' });
    if (evtRef.current) evtRef.current.close();
    setRunning(false);
    setStatus('IDLE');
  }, []);

  return { running, status, progress, start, stop };
}
