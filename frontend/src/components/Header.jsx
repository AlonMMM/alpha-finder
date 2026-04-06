const statusStyle = {
  IDLE:    'bg-slate-800 text-slate-400',
  RUNNING: 'bg-yellow-900/40 text-yellow-400',
  DONE:    'bg-emerald-900/40 text-emerald-400',
  ERROR:   'bg-red-900/40 text-red-400',
};

export default function Header({ status }) {
  return (
    <div className="border-b border-slate-800 px-6 py-4">
      <div className="max-w-screen-2xl mx-auto flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">⚡ Alpha Finder</h1>
          <p className="text-slate-400 text-xs mt-0.5">
            Nasdaq relative strength scanner · Beta-adjusted divergence
          </p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusStyle[status] || statusStyle.IDLE}`}>
          {status}
        </span>
      </div>
    </div>
  );
}
