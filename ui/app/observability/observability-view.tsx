"use client";

import * as React from "react";

export function ObservabilityView() {
  return (
    <main id="main-content" className="mx-auto w-full max-w-screen-2xl px-6 py-6">
      <header className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-xl font-semibold text-foreground">All Sessions</h1>
          <p className="text-sm text-muted-foreground">System-wide token usage</p>
        </div>
        {/* freshness indicator — added in P02-T01 */}
      </header>

      {/* summary cards — P02-T02 */}
      {/* total rate chart — P02-T03 */}
      {/* control bar — P03-T01 */}
      {/* session table — P03-T02 */}
    </main>
  );
}
