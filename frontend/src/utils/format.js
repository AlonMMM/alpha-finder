export const fmtPct = (v) => {
  if (v == null) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
};

export const fmtMC = (v) => {
  if (!v) return '—';
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(1) + 'T';
  if (v >= 1e9)  return '$' + (v / 1e9).toFixed(1)  + 'B';
  return '$' + (v / 1e6).toFixed(0) + 'M';
};

export const fmtNum = (v, d = 2) => {
  if (v == null) return '—';
  return parseFloat(v).toFixed(d);
};

export const tierConfig = {
  STRONG:        { cls: 'bg-emerald-900/60 text-emerald-300', label: 'STRONG' },
  OUTPERFORMER:  { cls: 'bg-blue-900/60 text-blue-300',       label: 'OUTPERFORMER' },
  RELATIVE_ONLY: { cls: 'bg-amber-900/60 text-amber-300',     label: 'REL ONLY' },
};
