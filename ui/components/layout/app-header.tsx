"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HelpCircle, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConnectionIndicator } from "@/components/badges";
import { ThemeToggle } from "@/components/theme";
import { cn } from "@/lib/utils";
import type { SSEConnectionStatus } from "@/types/events";

export interface NavLink {
  label: string;
  href: string;
}

interface AppHeaderProps {
  sseStatus: SSEConnectionStatus;
  onReconnect: () => void;
  onConfigClick?: () => void;
  navLinks?: NavLink[];
  version?: string;
}

export function AppHeader({ sseStatus, onReconnect, onConfigClick, navLinks = [], version }: AppHeaderProps) {
  const pathname = usePathname();
  return (
    <header
      role="banner"
      className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-border bg-card px-4"
    >
      <div className="flex items-center gap-6">
        <div className="flex items-baseline gap-2">
          <h1 className="text-sm font-semibold tracking-tight">
            Rad Orchestration
          </h1>
          {version && (
            <span
              className="text-xs text-muted-foreground/60 font-mono tabular-nums"
              aria-label={`Version ${version}`}
            >
              v{version}
            </span>
          )}
        </div>

        <nav aria-label="Main navigation" className="flex items-center gap-1">
          {navLinks.map((link) => {
            const isActive = link.href === "/"
              ? pathname === "/"
              : pathname === link.href || pathname.startsWith(link.href + "/");
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <nav aria-label="Dashboard controls" className="flex items-center gap-3">
        <ConnectionIndicator status={sseStatus} />
        {sseStatus === "disconnected" && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={onReconnect}
          >
            Retry
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          aria-label="Docs"
          render={
            <Link href="/docs">
              <HelpCircle size={16} />
            </Link>
          }
        />

        {onConfigClick !== undefined && (
          <Button variant="ghost" size="icon" aria-label="Configuration" onClick={onConfigClick}>
            <Settings size={16} />
          </Button>
        )}

        <ThemeToggle />
      </nav>
    </header>
  );
}
