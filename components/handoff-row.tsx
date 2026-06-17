import type { Handoff } from "@/lib/types";
import { HandoffStatusBadge } from "./badges";

export function HandoffRow({ handoff }: { handoff: Handoff }) {
  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-text">{handoff.from_party}</span>
        <span className="text-accent">→</span>
        <span className="font-mono text-xs text-text">{handoff.to_party}</span>
        <span className="ml-auto">
          <HandoffStatusBadge status={handoff.status} />
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted">{handoff.ask}</p>
      <div className="mt-2 font-mono text-[10px] text-muted">{handoff.packet_id}</div>
    </div>
  );
}
