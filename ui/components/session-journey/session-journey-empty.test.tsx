import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionJourneyEmpty } from "./session-journey-empty";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const source = readFileSync(join(__dirname, "session-journey-empty.tsx"), "utf-8");

test("renders the specified empty-state copy", () => {
  const html = renderToStaticMarkup(createElement(SessionJourneyEmpty));
  assert.ok(html.includes("No sessions have been recorded."));
  assert.ok(html.includes("/rad-session"));
  assert.ok(html.includes("to manually record a session."));
});

test("imports CARD_SHELL_CLASSES rather than restating the card shell", () => {
  assert.ok(source.includes("CARD_SHELL_CLASSES"));
});
