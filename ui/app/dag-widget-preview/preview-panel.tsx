"use client";

import * as React from "react";
import { DagStateCard } from "@/components/dag-widget";
import { PREVIEW_STATES } from "./mock-state";

// TEMPORARY — brainstorm inspection aid only, not part of the shipped feature.
// Delete this whole app/dag-widget-preview/ route once the review is done.

export function PreviewPanel() {
  const [index, setIndex] = React.useState(0);
  const entry = PREVIEW_STATES[index];

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIndex((i) => (i - 1 + PREVIEW_STATES.length) % PREVIEW_STATES.length)}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent/50"
        >
          ← Prev
        </button>
        <div className="text-center">
          <div className="text-sm text-muted-foreground">
            {index + 1} / {PREVIEW_STATES.length}
          </div>
          <div className="text-base font-medium">{entry.label}</div>
        </div>
        <button
          type="button"
          onClick={() => setIndex((i) => (i + 1) % PREVIEW_STATES.length)}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent/50"
        >
          Next →
        </button>
      </div>

      <DagStateCard
        state={entry.state}
        focus={entry.focus}
        onDocClick={() => {}}
        compareUrlByRepo={{ ui: "https://github.com/example/rad-orc/compare/main...radorch/demo" }}
        projectName="demo"
      />

      <div className="flex flex-wrap justify-center gap-2">
        {PREVIEW_STATES.map((s, i) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setIndex(i)}
            className={`rounded-md border px-2 py-1 text-xs ${i === index ? "bg-accent" : "hover:bg-accent/50"}`}
          >
            {s.key}
          </button>
        ))}
      </div>
    </div>
  );
}
