import { useState } from 'react';

const statusStyle = {
  IDLE:    'bg-slate-800 text-slate-400',
  RUNNING: 'bg-yellow-900/40 text-yellow-400',
  DONE:    'bg-emerald-900/40 text-emerald-400',
  ERROR:   'bg-red-900/40 text-red-400',
};

export default function Header({ status, ibAuth }) {
  const isAuthed = ibAuth?.authenticated && ibAuth?.connected;
  const [disconnecting, setDisconnecting] = useState(false);

  const disconnect = async () => {
    setDisconnecting(true);
    await fetch('/api/ib/logout', { method: 'POST' }).catch(() => {});
    setDisconnecting(false);
  };

  return (
    <div className="border-b border-slate-800 px-6 py-4">
      <div className="max-w-screen-2xl mx-auto flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">⚡ Alpha Finder</h1>
          <p className="text-slate-400 text-xs mt-0.5">
            Nasdaq relative strength scanner · Beta-adjusted divergence
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* IBKR auth badge */}
          <span className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full border ${
            isAuthed
              ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
              : 'bg-slate-800 text-slate-400 border-slate-700'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isAuthed ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            {isAuthed ? 'IBKR Connected' : 'IBKR Offline'}
          </span>

          {isAuthed ? (
            <button
              onClick={disconnect}
              disabled={disconnecting}
              className="bg-slate-700 hover:bg-red-900/60 hover:text-red-400 disabled:opacity-40 text-slate-300 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors border border-slate-600 hover:border-red-800"
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </button>
          ) : (
            <button
              onClick={() => {
                fetch('/api/ib/login', { method: 'POST' });
                window.open('https://localhost:5055', '_blank');
              }}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              Login with IBKR →
            </button>
          )}

          {/* Scanner status */}
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusStyle[status] || statusStyle.IDLE}`}>
            {status}
          </span>
        </div>
      </div>
    </div>
  );
}
