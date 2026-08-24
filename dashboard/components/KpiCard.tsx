export function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface border border-line rounded-card shadow-card p-6">
      <div className="text-[11px] font-semibold text-ink-3 tracking-wider uppercase mb-2">{label}</div>
      <div className="text-2xl font-extrabold text-ink">{value}</div>
    </div>
  );
}
