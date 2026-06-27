# Architecture & Technical Visuals

When a brainstorm turns technical — architecture, data flow, component relationships, state lifecycles, interaction sequences — a diagram usually communicates faster and more precisely than paragraphs. This reference covers **when** to offer a technical visual, **which type** to reach for, and **how** to produce one.

## When to Offer

The moment a technical structure enters the conversation — components, services, data movement, request/response flows, lifecycles and states, schemas, or deployment — **proactively offer a diagram** without waiting for the user to ask: *"want me to sketch this as a quick architecture diagram so we can see how it fits together?"*  Generate only on confirmation.

- **Offer, don't impose.** Never auto-generate. Follow their lead — if they decline, return to prose.
- **Never push the conversation technical** before the user is ready; the skill's default stance is high-level first.
- **Altitude test:** if you're about to describe a system in three or more paragraphs of prose, a diagram is probably the better artifact.

## The Menu — Offer the Right Type

Pick by the question the user is actually asking. Offer one focused diagram, not a pile; if several would help, sequence them across the conversation.

| Diagram type | Answers | Reach for it when… |
|---|---|---|
| **Component / container architecture** | "How do the pieces fit together?" | mapping modules/services and their relationships; showing where state or logic lives |
| **Sequence / interaction** | "Who calls whom, in what order?" | a request/response or multi-step interaction across actors, over time |
| **Data-flow** | "How does data move through the system?" | tracing inputs → transforms → outputs / stores |
| **State machine / lifecycle** | "What states exist, and how do we move between them?" | an entity or UI with distinct states and transitions |
| **Entity-relationship / data model** | "What are the entities and how do they relate?" | schema, records, cardinality |
| **Flowchart / decision logic** | "What's the branching logic?" | conditional flows, algorithms, decision trees |
| **Deployment / topology** | "Where does it run and how is it wired?" | services, hosts, queues, network boundaries |
| **Swimlane / process** | "Who does what, across roles?" | cross-actor or cross-team processes |

## Ground It in the Code

If the project has a codebase, a technical diagram **must be grounded in it** — not a generic pattern:

- Map boxes to **real** files / modules / routes, and **verify the names exist** before drawing them.
- Reflect how the system *actually* works (the real state approach, the real transport, the real entry points) — not an idealized version.
- Include a small **"grounded in the code"** footnote mapping diagram nodes ↔ real files, so reviewers can trust it.

A quick read/search pass before drawing is worth it. An ungrounded diagram that looks authoritative is worse than no diagram.

## Keep It High-Level

These are **communication artifacts to align humans**, not implementation specs:

- Boxes and relationships over exhaustive detail. Show the *shape*, not every field.
- UML-ish is good — stereotypes (`«provider»`, `«route»`, `«component»`), labeled connectors, a legend — but approachable, not a formal spec.
- **One clear takeaway per diagram.** Highlight the thing that matters (e.g., where state sits).

## Crafting Flow & Sequence Diagrams

Flow / sequence diagrams — swimlanes, modules-as-boxes, labeled connector arrows — are the highest-value and the easiest to get subtly wrong. Treat the following as a build recipe.

**Build approach**

- **Inline SVG for the canvas** (boxes, connectors, arrowheads); wrap it in HTML for the title, legend, callouts, and the grounded-in-code footnote. Still **no JavaScript**.
- **Group modules into swimlanes** — horizontal or vertical bands by layer or actor (e.g. Filesystem → Server → Transport → Client). Give each a clean label tab in the gutter.
- **Label every connector** with a short edge label in a small pill, and define **one reusable arrowhead `<marker>` per color** (don't redefine per arrow).
- **Encode edge meaning** with line style plus a legend — e.g. solid = primary / push flow, dashed = secondary / pull (fetch), a warm color = health / error path. **Always include the legend.**
- **Visio / Lucid polish:** rounded boxes, soft drop shadows, stereotype tags (`«provider»`, `«bus»`…), and a distinct accent color per lane.

**Pitfalls that make a diagram look broken** — every one of these has bitten real diagrams:

| Pitfall | Do this instead |
|---|---|
| Lane title + subtitle stacked at one coordinate (rotated SVG text overlaps into mush) | **One label per lane.** Only add a subtitle with real perpendicular offset, and only where the lane is tall enough — otherwise drop it. |
| Arrows that float near their target | **Connect edge-to-edge.** Every connector must terminate *on* a box edge; verify each endpoint. |
| Lines crossing through a box or label | **Route around** via gutters / margins / channels. Mind draw order — a line drawn after a label paints over it. |
| Cramped layout (reads as broken even when correct) | **Breathing room.** Generous gaps between boxes and lanes; size the canvas large enough; don't cram. |
| Labels overflowing a narrow side channel, or two parallel paths' labels colliding | Place the label in **open interior space** near the line instead, and keep parallel-path labels apart. |

## How It's Produced

Generate the diagram **inline** as a **self-contained HTML** file in the project root, dark house style with the lavender accent, inline CSS, and **no JavaScript for layout** (so it stays sandbox-safe in the in-app viewer).

**Naming:** `{PROJECT}-TECH-DIAGRAM-{SLUG}.html`, where `{SLUG}` is `SCREAMING-CASE` for the diagram's subject or type — e.g. `ARCHITECTURE`, `LOGIN-SEQUENCE`, `DATA-FLOW`, `STATE-MACHINE`. Multiple are allowed, one per slug. They live alongside the brainstorm doc and any wireframes, and surface through the same in-app artifact viewer.
