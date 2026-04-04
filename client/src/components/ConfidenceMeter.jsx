export default function ConfidenceMeter({ score, className = '' }) {
  const pct = Math.round((score || 0) * 100);
  const color = pct >= 70 ? 'bg-emerald-500' : pct >= 45 ? 'bg-amber-500' : 'bg-red-500';
  const textColor = pct >= 70 ? 'text-emerald-700' : pct >= 45 ? 'text-amber-700' : 'text-red-700';

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs font-semibold tabular-nums ${textColor}`}>
        {pct}%
      </span>
    </div>
  );
}
