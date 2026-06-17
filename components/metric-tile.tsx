export function MetricTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="tile ticked rounded-lg border border-border p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
        {label}
      </div>
      <div className="tabular accent-glow mt-3 font-mono text-[2.75rem] font-semibold leading-none text-text">
        {value}
      </div>
      {sub && (
        <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted">
          {sub}
        </div>
      )}
    </div>
  );
}
