"use client";

import { SSEProvider, useSSEContext } from "@/hooks/use-sse-context";
import { ConfigClickProvider, useConfigClickContext } from "@/hooks/use-config-click-context";
import { AppHeader } from "./app-header";
import type { NavLink } from "./app-header";

// ─── Nav Links ───────────────────────────────────────────────────────────────

const NAV_LINKS: NavLink[] = [
  { label: "Projects", href: "/projects" },
  { label: "Repo Registry", href: "/repo-registry" },
  { label: "Process Editor", href: "/process-editor" },
  { label: "Instruction Editor", href: "/action-events" },
  { label: "Observability", href: "/observability" },
  { label: "Brainstorm POC", href: "/brainstorm-poc" },
];

// ─── Props ───────────────────────────────────────────────────────────────────

interface AppHeaderShellProps {
  children: React.ReactNode;
  version?: string;
}

// ─── Inner Component ─────────────────────────────────────────────────────────

function AppHeaderShellInner({ children, version }: AppHeaderShellProps) {
  const { sseStatus, reconnect } = useSSEContext();
  const { onConfigClick } = useConfigClickContext();

  return (
    <>
      <AppHeader
        sseStatus={sseStatus}
        onReconnect={reconnect}
        onConfigClick={onConfigClick}
        navLinks={NAV_LINKS}
        version={version}
      />
      {children}
    </>
  );
}

// ─── Shell Component ──────────────────────────────────────────────────────────

export function AppHeaderShell({ children, version }: AppHeaderShellProps) {
  return (
    <SSEProvider>
      <ConfigClickProvider>
        <AppHeaderShellInner version={version}>{children}</AppHeaderShellInner>
      </ConfigClickProvider>
    </SSEProvider>
  );
}
