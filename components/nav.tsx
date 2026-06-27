"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import type { Role } from "@/lib/roles";

const LINKS = [
  { href: "/", label: "Core" },
  { href: "/sourcing", label: "Deals" },
  { href: "/inbox", label: "Inbox" },
  { href: "/replies", label: "Replies" },
  { href: "/agents", label: "Agents" },
  { href: "/projects", label: "Projects" },
  { href: "/sales", label: "Sales" },
  { href: "/contacts", label: "Contacts" },
  { href: "/texts", label: "Texts" },
  { href: "/lending", label: "LLS" },
  { href: "/pgo", label: "PGO" },
  { href: "/asset-mgmt", label: "Assets" },
  { href: "/bridge", label: "Bridge" },
  { href: "/trends", label: "Trends" },
  { href: "/ask", label: "Ask" },
  { href: "/business-brain", label: "Brain" },
];

export function Nav({ role }: { role?: Role | null }) {
  const path = usePathname();
  // A caller (dialing VA) only ever sees the Deals tab.
  const links = role === "caller" ? LINKS.filter((l) => l.href === "/sourcing") : LINKS;
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="dot-pulse h-2 w-2 rounded-full bg-accent" />
          <span className="font-mono text-sm font-semibold tracking-[0.22em] text-text">
            JARVIS
          </span>
          <span className="hidden font-mono text-[10px] tracking-[0.2em] text-muted sm:inline">
            COMMAND CENTER
          </span>
        </Link>
        <nav className="ml-auto flex items-center gap-0.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {links.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`relative rounded px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "text-accent"
                    : "text-muted hover:bg-panel-2 hover:text-text"
                }`}
              >
                {l.label}
                {active && (
                  <span className="absolute inset-x-2 -bottom-[1px] h-[2px] rounded-full bg-accent shadow-[0_0_8px_var(--accent)]" />
                )}
              </Link>
            );
          })}
          <a
            href="/auth/signout"
            title="Sign out"
            className="ml-2 rounded px-2 py-1.5 text-muted transition-colors hover:bg-panel-2 hover:text-text"
          >
            <LogOut size={15} />
          </a>
        </nav>
      </div>
    </header>
  );
}
