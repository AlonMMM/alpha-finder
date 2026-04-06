import { useEffect, useRef } from 'react';

const lineColor = (line) => {
  const l = line.toLowerCase();
  if (l.includes('error')) return 'text-red-400';
  if (l.includes('warn'))  return 'text-yellow-400';
  return 'text-emerald-300';
};

export default function LogTerminal({ logs, onClear }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Live Log</span>
        <button onClick={onClear} className="text-xs text-slate-500 hover:text-slate-300">Clear</button>
      </div>
      <div className="h-48 overflow-y-auto p-4 bg-slate-950 font-mono text-xs space-y-0.5">
        {logs.map((line, i) => (
          <div key={i} className={lineColor(line)}>{line}</div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
