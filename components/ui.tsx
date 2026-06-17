export function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-6 border-b border-border pb-4">
      <h1 className="flex items-center gap-2.5 font-mono text-xl font-semibold tracking-[0.15em] text-text">
        <span className="h-3 w-[3px] rounded-full bg-accent shadow-[0_0_8px_var(--accent)]" />
        {title}
      </h1>
      {subtitle && <p className="mt-2 max-w-2xl text-sm text-muted">{subtitle}</p>}
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
      <span className="text-accent">▸</span>
      {children}
    </h2>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-panel/50 p-6 text-center text-sm text-muted">
      {children}
    </div>
  );
}
