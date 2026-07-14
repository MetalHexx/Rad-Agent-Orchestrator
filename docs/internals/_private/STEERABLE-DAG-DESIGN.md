---
project: "STEERABLE-DAG"
type: design
status: draft
created: "2026-07-03"
updated: "2026-07-14"
project-type: standard
repos: [rad-orc-source]
repo-group: rad-orc
---

# STEERABLE-DAG — Initiative Design

Umbrella anchor for the STEERABLE-DAG initiative. What began as "make the execution
DAG steerable" has grown, through design, into its truer form: **re-platform the
orchestration backend as a deterministic graph engine behind a service** — greenfield,
side-by-side with today's pipeline — so that steering, parallelism, custom node types,
and an eventual multi-project "factory" all fall out of one clean architecture instead
of being bolted onto the current rigid one.

This doc is the durable record of the vision, the locked cross-cutting decisions, the
cross-cutting threads, and the iteration spine. Each numbered iteration
(`STEERABLE-DAG-{N}`) is planned and delivered independently; this doc is what they all
inherit.

> Project-groups can't carry docs today, so this un-numbered `STEERABLE-DAG` project
> holds the initiative doc. All iterations are grouped under `group:steerable-dag`.

## The Vision

A deterministic **graph engine** — dag nodes, edges, readiness, validated mutations —
that knows nothing about HTTP, files, git, or agents. It is hosted by a **graph service**
that owns a SQLite-backed store and streams changes; the CLI, the dashboard, and the
orchestrator agent are all **clients** of that service. Node types are
**self-describing** and **namespaced** (`rad-orc:` shipped, a **team-chosen** namespace for
custom), resolved at runtime through one registry — our own built-ins dogfood the exact same
contract a team would use to drop in a custom node.

The engine runs the **execution dag inside a project**. A **project** is a first-class
system entity that *owns* a dag (plus its worktrees, PRs, source-control, docs, and
state); **project-groups** collect related projects. The portfolio **work-graph**
(projects and their relationships) and a project's execution dag are served by the *same
engine model* at two tiers — **composed, not flattened into one instance** — so that one
day we can queue and run **many projects** through the one service (the "dark factory")
without the engine ever having to execute a project. Not today; but every decision is
made so that future is reachable without re-founding.

## The Problem (where it started)

Once a project's state is generated, today's DAG is effectively frozen. The system is
deterministic by design — the engine owns routing, state is derived not stored, every
write is schema-validated — and that rigor is a strength. But it means an operator can't
reshape a run in flight: no adding/removing phases or tasks, no turning a review off for
a trivial task, no clean recovery from a halt, no running things in parallel, and no way
to teach the DAG a genuinely new kind of step. The goal is execution-time flexibility
**without** giving up determinism — by modeling everything as **validated, deterministic
graph mutations**.

## Current System (what we're replacing)

Established via deep code review of `cli/src/lib/pipeline-engine/` (21 modules) and the
surrounding CLI/UI:

- **Template + `state.json` v6 mirror**, walked in-memory each event. Nodes are
  **id-keyed map entries**, not positional — only for-each *iterations* are array elements.
  The core rigidity is that they are **ephemeral, template-derived, never durable**: the
  template is a **live input re-read every tick**: `explode-master-plan` seeds empty
  iteration maps, and the *walker* lazily scaffolds review/gate nodes from the template
  body on each walk. Review nodes are therefore ephemeral derivations of the template,
  never durable entities — which is precisely why a run cannot be trimmed or reshaped
  without editing the template and doing `state.json` surgery.
- **Closed node-kind enum** baked into the schema (`step | gate | for_each_phase |
  for_each_task | conditional | parallel` — six members) — a custom node type cannot even
  be represented.
- **Correctives** are a nested bespoke hierarchy special-cased across several modules.
- **Sequential only** — a single active node, sequential by construction (no parallel frontier).
- **Whole-file JSON writes** (temp+rename); the UI reads `state.json` from
  disk via chokidar → SSE. Prompt composition does filesystem I/O inside the engine.
- The **work-graph** (cross-project relationships) is a loose overlay bolted onto a flat
  project list — not a true graph.
- Strong discipline, but a model we've outgrown. The new engine is **not** a
  behavior-preserving port — it is the ideal design, run **side-by-side** until cutover.

## Target Architecture

Four layers, clean seams between them:

1. **Engine library** — deterministic, dependency-injected, in-process. Operates on the
   **execution dag within a project scope**: the dag model (flat `dag_nodes`, stable ids,
   typed `dag_edges`), the node-type contract + registry + built-ins, working-context-
   scoped readiness/frontier derivation, validated mutation + steering primitives, a
   parallel-native execution model, and validation. Declares **capability ports** (git-facts,
   doc-read, doc-write, spawn-agent, run-command, request-human) and a **`StateStore`
   interface** — implements neither. **It never processes a project or project-group** —
   its reach stops at the project boundary (D22).
2. **Graph service + store** — hosts the engine, owns the **SQLite** store (first-class
   `projects`/`project_groups` tables + scoped `dag_nodes`/`dag_edges` + append-only
   change-log), implements the capability ports, exposes an API (submit event / steer /
   query), and streams changes via **SSE**. Local daemon now; networked/hosted later.
   **Sole owner of the DB.** It — not the engine — is what *knows what a project is*.
3. **Clients** — the **CLI** (a new command set that calls the service over HTTP) and
   the **Next.js UI** (thin BFF → service; reacts to SSE instead of file watches).
   Neither touches the DB.
4. **Orchestrator** — the `/rad-orchestration` skill, rewritten to drive the new system:
   consume the multi-action (parallel) envelope, and **steer** the graph on the
   operator's behalf.

**Composed, not flattened.** The execution dag (inside a project) and the portfolio
work-graph (projects + their relationships) share the *same engine model* — nodes, edges,
containment, readiness, validated mutations — but are **distinct scoped graph instances**.
A project is a **boundary you walk through, not a node you dissolve**: the portfolio tier
schedules project *scopes*, and "running a project" means the engine running that
project's dag. One model gives a uniform query/steer surface across tiers; each tier keeps
its own edge semantics and its own concurrency/blast-radius isolation (D10/D22/D23).

**Determinism boundary.** The execution core is deterministic (validated mutations, no
LLM routing judgment). The *work inside a node* may be agentic. Any vector/RAG retrieval
is a **separate read-side layer** that helps an agent *know* things — never in the
decision path.

## Locked Decisions

| # | Decision |
|---|---|
| D1 | **Greenfield, side-by-side, not behavior-preserving.** New CLI command; today's `pipeline signal` is left untouched; the new stack is built in parallel and cutover happens at the **last responsible moment** (old pipeline retires around It. 5). Freedom to build the ideal system. |
| D2 | **Engine = deterministic, dependency-injected, in-process library.** Transport- and storage-agnostic — a host injects a `StateStore`, capability implementations, and the node-type registry. **The service is the single production host and the sole DB owner** (D9); the CLI, UI, and orchestrator are **clients** of the service, never embedders. The DI / `StateStore` seam exists for **tests** (an in-memory store) and to let the *service* swap its backing store later — **not** to create a second writer. |
| D3 | **Node types are self-describing** and resolved via a registry; the core hardcodes **no** node names. Built-ins are node types like any other — dogfood is the acid test, and **we dogfood by authoring our own**. |
| D4 | **Dag = flat dependency graph with stable ids.** Control-flow (sequencing, expansion, branching, parallelism) is largely **emergent** — expansion is a mutation, "parallel" is siblings with no dependency, "conditional" is a skip-condition — not heavy built-in constructs. Loops in particular do not earn their keep as a runtime construct. |
| D5 | **Correctives are an *additive* node type — a new node; the original persists.** A corrective is another *attempt* at reviewed work, born by `add_corrective` and carrying **the scope contract at its level + the running review report**. The original node stays `done`; the corrective adds fixing commits — or, in a **dispute-only** correction, rebuts the review in the running report and commits nothing. The shape is **uniform at task / phase / final**; only the scope contract widens (task handoff → phase plan → project requirements + phase plans). The level's `code_review` closes the loop by **resetting to `not_started`** and re-adjudicating the **same running report in place** (including the coder's disputes); each attempt is a distinct `derived_from` node, so the chain is an acyclic audit trail. **Routing is uniform at every level:** `approved → done`; `changes_requested → additive corrective`; `rejected → recoverable halt` (critical only, resumable after a human intervenes); corrective budget exhausted → halt. Corrective attempts are **flat** — each is a distinct node in the same container, addressed by id. |
| D6 | **Parallel-native from day one.** The cursor is a **set** (the ready frontier); multiple in-progress is legal (a scoped policy, not a global invariant). Execution parallelism is consumed by the new orchestrator. |
| D7 | **Steering = validated CRUD mutations** (add / remove / toggle / resume), deterministic. The *primitives* live in the engine; the *surface* threads through every layer (service API, CLI, orchestrator instructions, UI). |
| D8 | **SQLite-backed relational store.** Stable ids, flat `dag_nodes`, open node-type-owned `data`, append-only change-log (the event history v6 never had). A clean new format — **not** v6, no migration. Run docs stay **markdown files**; the DB stores `~/.radorc/projects`-relative refs to them. |
| D9 | **One graph service owns the DB + engine; CLI and Next.js are clients; SSE streams changes.** Local daemon now (auto-started, independent of the UI), networked/hosted later. |
| D10 | **Compose, don't flatten — one engine model, two scoped tiers.** The execution dag (inside a project) and the portfolio work-graph (projects + their `follows`/`spawned-from` relationships) are served by the *same engine model* — but as **distinct scoped graph instances**, never one flat tree. A project is a **first-class boundary**: it *owns* a dag; it is not a node inside one. The uniform model gives an agent one query/steer surface across tiers, while each tier keeps its own edge semantics (execution `depends_on` vs. portfolio `follows`) and its own blast-radius/concurrency isolation. Multi-project queueing (It. 6) reuses the engine's *structural substrate* over project **scopes** — projects are *scheduled as scopes, never executed as node-types*. |
| D11 | **gate_mode + task/phase approval gates retire.** Everything is autonomous; the review *verdict* drives task/phase advancement. **Plan-approval and final-approval survive** as an optional `approval` node type (human sign-off). "How much a run pauses" (the old task/phase/autonomous stepping) becomes a **driver pause-policy** — a host/orchestrator concern (It. 5), not node existence and not an engine construct. |
| D12 | **Determinism boundary.** The execution core stays deterministic; vector/RAG is a separate read-side layer, never in the decision path. |
| D13 | **DB design discipline + forward-compatible schema.** The store is designed with proper relational discipline. **Docs are a first-class association on any dag node _and_ on projects/project-groups** — retiring today's un-numbered-project workaround for group-level design docs (we plan at the group level, execute at the project level). The schema also **reserves** (designed-for, not built now) for: **external-system ID mapping** (Jira, GitHub Projects, …) so runs can update a company-level system of record; **external provider configuration**; and **teams / team configuration**; and the eventual absorption of today's **file-system libs** — **`repo-registry`** and **`telemetry`** (the change-log as its natural event feed) — which stay **FS-backed and coexisting** until migrated. Integrations are out of scope; the schema anticipates them. |
| D14 | **One dag-node envelope; every "type" is a node-type reference — within a project's dag.** No privileged core node types: `task`, `code_review`, `pr`, `corrective`, and the structural roles are node types resolved via the registry, no different in kind from a custom `team:security-scan`. Structural roles that carry a distinct shape are **thin declared node types** — `rad-orc:phase` = the `contains` trait (rollup + frontier scoping, engine-provided) + its own data-schema + presentation, *zero behavior code* — rather than one anonymous `container` distinguished only by tree position. The generic `contains` **trait** is the reusable primitive any node type opts into; the engine ships **no** bare `container` node type, and the never-null **project-scoped root** is a **core structural anchor** carrying the `contains` trait — minted outside the registry, so the core depends on the trait, never on a specific type name. "Type" decomposes into **structural position**, **behavior**, and **data/shape**; the core keeps only the sacred kernel — the dag-node envelope, the graph primitives, a minimal **status protocol**, and generic **traits** a node type opts into (`contains` / `routes` / `expands`). Node types are rich but **cannot redefine what "ready" structurally means. Project and project-group are NOT dag node-types (D22).** |
| D15 | **Working context — "you are always standing somewhere," within one scoped graph.** Every engine operation is relative to a **working context** — the node/scope you're under, the graph's `cwd` / `HEAD` — and the engine operates *within a scope*, never over "one global graph." Context **scopes the frontier** (D6): within a project → ready `dag_nodes` (tasks); the portfolio tier (It. 6) → ready projects, via the same substrate over a different scoped graph. Working context is **per-client** (each client carries its own, like separate shells), **not** stored on the graph and **not** keyed to a session; the engine's operations **accept a `context` (scope) argument.** A permanent, system-owned **root** guarantees context is never null *within a scope*. This **dissolves session-correlation** for after-run extension: adopting a plan attaches by _position_, which survives a session clear. |
| D16 | **Steering model — reshape the graph, never override it.** Four rules the steering surface obeys at every layer. **(1) The frontier is permission, not obligation** — a ready node is an _available_ move, not a forced one; "do it later" is just leaving it in the frontier. **(2) Starting a node is legal only when it is in the frontier**; to run out of order you _reshape the graph_ (edit dependency edges) so your order becomes the truth — there is **no force-run override**, because an override would leave the graph asserting a dependency that didn't actually hold (a lie every reader inherits). **(3) Steering is a closed set of validated, transactional engine primitives** (apply-event, add/remove node, add/remove dependency, re-parent, set-order, expand, add_corrective, reset, toggle, resume; removal carries a heal/cascade/detach strategy — splice is the heal case) — clients call primitives, never hand-write edge SQL; the engine owns the invariants (acyclicity, chain-healing, atomicity, change-log delta). **(4) Removal takes a strategy per downstream**: children `cascade` (default) or `promote`; dependents `heal` (splice), `cascade`, or `detach`. Destructive strategies **preview** their blast radius before commit; the append-only change-log makes them auditable/undoable. Deterministic — every run is explained by the graph as it stood. |
| D17 | **Design-ready for a visual graph editor (future, ~It. 7+).** The end-state steering surface is a drag-and-drop graph editor — every gesture _is_ a D16 primitive (drag-to-connect = add-dependency, drag-into-container = re-parent, drag-from-palette = add-node with the palette sourced from the **node-type registry**, delete/drop-branch = remove-node with a strategy). Four reserves **now** (designed-for, not built): **(a) mutations are dry-run-able** — every primitive exposes _validate_ and _preview_ (the cascade cone) as **reads**; **(b) presentation stays out of the core** — a node's layout/position/color is UI view-state, **never** baked into the dag-node envelope; **(c) the node-type contract carries a presentation slot** (icon / label / color / which `data` fields to surface) so custom node types render generically; **(d) client responses carry only node-owned data via generic slots** — the service relays the node's envelope and data opaquely to clients (CLI, dashboard) without interpreting it, the basis for a genuinely agnostic UI (clients render what the node exposes, never hard-coded type-specific presenters). Multi-cursor concurrent editing is a further-future reserve carried by the transaction + change-log + SSE spine. |
| D18 | **Node-type contract — derived from the built-ins, dogfood-validated.** A node type answers a fixed, small set the core asks — nothing more. **Static declarations:** a `data` schema (opt-in fields the template sets + the node tracks); the **traits** it uses (`contains` / `routes` / `expands`); the **capabilities** it requests (doc-read, doc-write, git-facts, spawn-agent, run-command, request-human — an **open vocabulary**: a node type may name a new capability without an engine edit); a **presentation** blob (D17); and its **instructions/catalog** (the action-events markdown, shipped _inside_ the node type — for inline actions it is the executable heart, not docs). **Behavior:** an `act` hook emitting _instructions + who-executes_ — **spawn-sub-agent · orchestrator-inline · request-human · noop** — plus an `event → state + routing/expansion` hook with a projection onto the core status. **Outcome derivation:** a **generic, polymorphic `resolve` hook** the host invokes after an external actor completes a node or when the driver auto-resolves a `noop`-executor node (deterministic host-side outcome derivation). The host calls each node type's own `resolve` hook if declared; no per-type outcome runner in the host — the hook is the sole code-bearing extension point. **Declarative floor:** the built-ins — `phase`, `master_plan` (inline), `explosion` (the canonical `expands`), `task`, `code_review` (task/phase/final by a declared level), `corrective`, `pr` (inline `gh` per repo), `approval` (review with a human) — are **almost all pure declaration**; where a built-in needs code-behind (e.g., `explosion`'s plan-parsing transform to derive its expansion), it lives in the `resolve` hook, **host-side through the generic path** so the deterministic engine never executes foreign code (D2/D12). The built-ins _are_ the extension surface: if they are all node types, a custom one is complete by construction and AI-authorable from the spec + a built-in as reference. |
| D19 | **Contract-compatibility boundary — drop-in above, greenfield below.** The migration preserves the **document layer** and rebuilds everything beneath it. **Frozen (by contract):** the planning + report _documents_ and their frontmatter — task handoffs, review reports (`verdict`, findings), requirements, master/phase plans — plus the **agent spawn contracts** (`handoff_doc`, `repos[]`/`head_sha` (SHA fields are **level-specific** — see R8), `review_report_path`, …). Built-in node types reproduce these _unchanged_, so the coder/reviewer/source-control skills survive; a built-in's contract-match is its **test oracle**. **Replaced (greenfield):** `state.json` + engine internals (positional indices, `current_node_path`, gate_mode) — the store, not a doc. **Normalized (renamed now):** the internal **action/event vocabulary** is _not_ a frozen contract, so the greenfield adopts a consistent, namespaced **`<type>.<outcome>`** scheme (`task.completed`, `code_review.changes_requested`, `pr.created`, `approval.granted`/`denied`). **Two It-1 tasks:** (1) **inventory** every document + spawn contract; (2) **normalize** surviving action/event names — folding the collapses (tri-review → one `code_review` with a level; plan/final approval → one `approval`) and dropping the deaths (gates, D11). |
| D20 | **Templates are project-scoped seed graphs.** A template is a **named, declarative seed** for a project's dag — a set of typed, namespaced node references + wiring, authored in a nested / `each`-repetition form that **compiles to a flat dag at seed time** (the loop lives only in the authoring artifact; the runtime dag has no loops). It is **not an engine primitive**: seeding is just replaying the template through the engine's `add_node`/`add_dependency`/`expand` primitives, then it retires (kept as inert provenance, optionally re-invokable to decorate a later subtree). **Explosion is one optional node type** in a template (the `expands` archetype — parse the master plan, stamp the decorated execution subgraph); a template may have **no master_plan and no explosion** (a QA or security workflow is a static chain of its own node types). **Review intensity is post-seed trimming, not a pre-trimmed template**: the shipped coding template seeds *maximal* review coverage and the planner/operator **removes** nodes (via `remove_node`) to reach the desired intensity — enabling per-node precision (e.g. review only the complex tasks). The four v6 tiers collapse into one coding template + trim-shortcuts (a planning-layer concern, above the engine). |
| D21 | **Node-type identity is namespaced `namespace:name`.** Shipped built-ins are `rad-orc:*` (`rad-orc:task`, `rad-orc:code_review`, `rad-orc:phase`, …); custom types use a **team-chosen namespace** (e.g. `acme-qa:playwright_run`; `team:*` is illustrative, not a literal). Names resolve through the one injected registry; **`rad-orc:*` is the sole reserved namespace** and `namespace:name` is globally unique, so a custom can never shadow a future built-in (collision-proof by construction); *who may claim a namespace* is host governance (It. 2). Origin is visible at the reference site, and it mirrors the existing `rad-orc:`-namespaced *skill* convention. The `builtin/` vs `custom/` discovery-folder split (It. 2) is the physical home; the namespace is the logical identity. |
| D22 | **Project & project-group are first-class *system* entities, not dag nodes.** A **project** is the run boundary: it *owns* a dag and everything that hangs off a run — worktrees, PRs, source-control config, docs, state, the UI `/projects` view, and (future) queue position. Its only peer is another project; it is **not** peerable by an executable node type. A **project-group** (renamed from "group") collects related projects toward an overarching goal. They are owned by the **service**, not modeled inside the engine. **The engine processes only `dag_nodes`, and its reach stops at the project boundary** — a project has no `act`/executor (you don't spawn an agent to "run a project"; you run its dag), so forcing it through the node-type contract would reintroduce the `switch(kind)` disease. At It. 6 the scheduler may reuse the engine's *structural substrate* over project scopes, but projects remain scheduled scopes, never `act`/`handle` node-types. |
| D23 | **Storage shape (It. 2 realization of D8/D10/D13).** First-class **`projects`** and **`project_groups`** tables (rich typed columns — type, source-control, status, external-system ids), **`project_edges`** for portfolio relationships (`follows`, `spawned-from`), one **`dag_nodes`** + **`dag_edges`** pair for *all* execution graphs **partitioned by `project_id`** (never table-per-project), a **`docs`** table (first-class on any dag node, project, or project-group), and an append-only **`change_log`**. Separation is on **first-class-ness and edge semantics**, not table size — at this system's scale (~10²–10⁵ rows) a scoped index makes total row count irrelevant. The `StateStore` presents "a graph within a scope" so the engine never knows which tables back a scope. |
| D24 | **The host is node-blind, too.** `graph-service` depends only on the **node-type contract**, never a concrete type's name/tokens/data-shape/code, and discovers all node types through one path (`node-types/scan.ts`'s `discoverNodeTypes`). D14 said this for the engine; D24 extends it to the host. **Dependency direction invariant:** `graph-node-types → graph-engine` (types depend on the engine's contract); `graph-service → graph-engine` (service depends on the engine, not on node types); **no** `graph-service → graph-node-types` (discovery via scan, not import). Built-in node types are discovered and composed the same way custom types are — from disk, through the registry, with no hard-coded references in the service. Node types are resolved at composition time, invoked via the polymorphic `resolve` hook (D18) at runtime, relayed to clients opaquely (D17). The generic outcome hook + built-ins-from-disk were corrections this phase (2.6) makes — skipped in earlier conception, not consciously deferred. |

## Cross-Cutting Threads

These are **not** iterations — they run through **every** iteration, and every iteration
must keep the design ready for them:

- **Steering.** Add / remove / toggle / resume as validated mutations. Primitives in
  It. 1; API in It. 2; CLI commands in It. 3; orchestrator instructions in It. 5; UI
  controls in It. 7. Designed in from the first line.
- **Parallel.** Multi-active model + frontier in It. 1; concurrent execution + write
  safety (SQLite transactions) in It. 2; driven by the orchestrator in It. 5; visualized
  in It. 7.
- **Custom node types + dogfood.** The open, namespaced node-type contract exists from
  It. 1, and our built-ins are authored **as node types** against it (dogfood).
  Discovery/loading of third-party node types matures later, but the shape must never make
  it awkward — checked every iteration. This is where the prior `DAG-PLAYBOOK`
  "Invent / Plugins & sharing" vision comes home.
- **Templates & workflows.** Templates as project-scoped seed graphs (D20) let a team ship
  a *workflow* — its own custom node types + a template that composes them (QA, security,
  accessibility). Contract from It. 1; the template file format + loader land host-side
  (It. 2+); the planning-layer trim/authoring UX lands in the orchestrator/UI iterations.

## Iteration Spine

Foundation → service → clients → delivery → orchestrator → factory → UI. Boundaries are
intentionally fluid; each iteration is formally planned in its own fresh session. **All
iteration docs beyond It. 1 are thin placeholders today.**

| Iteration | Scope | Delivers |
|---|---|---|
| **STEERABLE-DAG-1** | **Engine library** — deterministic DI core for a project's execution dag: dag model, node-type contract + built-ins + registry, readiness/frontier, validated mutation + steering primitives, parallel-native model, validation, capability ports, `StateStore` interface + in-memory impl. Proven by clean behavioral tests. | The reusable engine. No service, DB, CLI, or host but the test harness. |
| **STEERABLE-DAG-2** | **Service + DB** — the graph service that hosts the engine: SQLite store (first-class project tables + scoped `dag_nodes`/`dag_edges` + change-log per D23), capability implementations, the API surface, SSE, the **node-type registry discovery/scan** (the `~/.radorc/node-types/` layout + precedence), and the **template file format + loader**. Framework + persistence/backup decided here. | First durably-runnable system; sole DB owner. |
| **STEERABLE-DAG-3** | **CLI client** — a new `radorch` command set that calls the service over HTTP, including the steering commands. | Operator + orchestrator can drive and steer runs via the CLI. |
| **STEERABLE-DAG-4** | **Packaging + delivery** — wire the engine/service into the distribution model: standard installer (npx-based package) + Claude Code & Copilot harness plugins; service lifecycle; SQLite packaging; **deploy the built-in node types *and* the new-format node-graph templates to `~/.radorc/node-types/{builtin,custom}` + `~/.radorc/node-graph-templates/`** (the on-disk homes It. 2.6 built the scanner/loader to read but deliberately left the installer to fill — beside today's legacy `~/.radorc/templates`). | The new stack installs and runs the way rad-orc ships. |
| **STEERABLE-DAG-5** | **`/rad-orchestration` skill** — rewrite the orchestrator to drive the new system: consume the multi-action (parallel) envelope, steer on the operator's behalf, own the driver pause-policy (D11) and template trim-shortcuts. **Cutover point** — old pipeline retires at the last responsible moment. | The production orchestrator on the new stack; old pipeline retired. |
| **STEERABLE-DAG-6** | **Multi-project scheduler** *(proposed — confirm)* — queue and run multiple projects through the one service; the portfolio-tier scheduler over project scopes (reusing the engine substrate per D10/D22). The "dark factory" first step. | Many projects queued and run through one service. |
| **STEERABLE-DAG-7** | **UI + SSE** — the dashboard adopts the service API (drops chokidar/file-watch + fs-reader), consumes SSE, and surfaces steering controls + parallel visualization. | Steering + parallel, end-to-end, in the dashboard. |

**Cutover** (D1) is a milestone, not an iteration — the old `pipeline signal` stack keeps
serving existing projects until It. 5 adopts the new command; then it retires.

## When Deferred Pieces Land

A **capability-indexed** view of everything designed-for but not built in It. 1, so nothing is
lost between iterations. The Iteration Spine above is the *forward* view (what each iteration
delivers); this is the *reverse index* — for a given piece, which iteration owns it. Each row
traces to the decision that defers it.

| Deferred piece | Lands in | Note |
|---|---|---|
| **Generic outcome hook + built-ins-from-disk** — the polymorphic `resolve` hook every node type may declare; discovery of built-in node types from disk alongside custom types (no hardcoded references in the service) | **It. 2.6** | Originally It. 1 shipped the registry interface + a hypothetical code-behind slot per type; It. 2.6 realizes that the slot is one generic, polymorphic `resolve` hook the host invokes uniformly (D18/D24), and built-ins are discovered like any custom type — corrections that tighten the architecture, improving testability and type-blindness. These are not deferred; they are earlier-stage revisions now shipped (D24). |
| **Node-type registry discovery** — the filesystem scan, the `~/.radorc/node-types/{builtin,custom}` layout + precedence | **It. 2** | It. 1 ships the registry *interface* + resolution + the manifest contract; the host that *builds* the map is It. 2 (D3/D21). |
| **Template file format + loader/scanner** | **It. 2** | It. 1 ships only the seed-graph *contract* — the `expand` wiring + `explosion`'s decoration — proven via a template-shaped fixture in the harness. **No template *file* exists until It. 2** (D20). |
| **Namespace claiming** — who may claim a namespace | **It. 2** (host) | It. 1 enforces only the sole reserved `rad-orc:*` + global uniqueness; the namespace is otherwise open and team-chosen (D21). |
| **Node-type trust** — signing / trust / versioning | **further-future** | Beyond It. 2; unspecified for now (R4). |
| **Real store (SQLite)** + append-only change-log persistence + SSE | **It. 2** | It. 1 ships the `StateStore` *interface* + an in-memory impl + the change-delta shape + the emission seam (D8/D23). |
| **Async capability ports** + per-node revision/CAS (concurrent-client safety) | **It. 2** | It. 1 bakes in the *open capability vocabulary* + synchronous ports; the It. 1 seams are shaped so It. 2 adds these without reshaping the engine (D2). |
| **CLI client** — steering commands over HTTP | **It. 3** | The steering *primitives* are It. 1; the operator command surface is It. 3. |
| **Packaging / installer** — built-in node types seeded to `~/.radorc/node-types/builtin/` **+ new-format node-graph templates deployed to `~/.radorc/node-graph-templates/`**, harness plugins, service lifecycle | **It. 4** | The stack installs the way rad-orc ships. It. 2.6 builds the *reader* (scan + loader) and exercises it against temp dirs + a dev seed script; It. 4 is the *writer* — and owns **both** the node-type and the template deployment (the latter beside today's legacy `~/.radorc/templates`). |
| **Driver pause-policy** (task/phase/autonomous stepping) + **template trim-shortcuts** (tier presets) + orchestrator rewrite | **It. 5** | "How much a run pauses" is host/orchestrator policy, not an engine construct (D11); trimming to an intensity is a planning-layer concern above the engine (D20). **Cutover happens here.** |
| **Multi-project scheduler** — portfolio tier over project scopes | **It. 6** *(proposed — confirm)* | Reuses the engine's structural substrate over project *scopes*; projects are scheduled, never executed as node-types (D10/D22). |
| **Visual graph editor** + steering controls + parallel visualization + SSE-driven UI | **It. 7** | It. 1 reserves the hooks now: every primitive is dry-run-able (validate + preview), presentation stays out of the core, the node-type contract carries a presentation slot (D17). |
| **`order` encoding** — possible lexo-rank swap | **It. 2+** | Advisory + opaque-sortable, so a swap is contract-neutral (D8; It. 1 Resolved Planning Decisions). |
| **External-system integration** (Jira / GitHub Projects), provider config, teams | schema-**reserved** in **It. 2**; integrations a **future initiative** | The store *anticipates* them (typed columns / id-mapping); the integrations themselves are out of this initiative's scope (D13/D23). |
| **Vector / RAG retrieval** | a **separate read-side layer**, never in the engine | Helps an agent *know* things; never in the decision path (D12). |

## Actor Model

- **Now:** human operator → instructs the orchestrator → orchestrator calls the graph
  service (drive + steer) → validated mutation → change streamed. Deterministic; no LLM
  routing judgment.
- **Later (out of scope):** the orchestrator steers autonomously; the service schedules
  **multiple projects** — the dark factory.

## Open Threads

- **It. 6 content** — multi-project scheduler is proposed; confirm (vs. reserving the
  slot for cutover-hardening or something else).
- **`order` encoding** (int-gaps vs. lexo-rank) is open — tracked in the
  [It. 1 requirements](../STEERABLE-DAG-1/STEERABLE-DAG-1-REQUIREMENTS.md) Open Questions;
  **store lineage/name** for the new format is an **It. 2** store decision. **Container
  children** is resolved: a single `parent` reference (D14 / R1).
- **`code_review` level & structural-role typing** — resolved: `code_review` carries a
  declared `level` (task/phase/final), consistent with structural roles being thin declared
  node types (D14) rather than position-inferred.
- **Template file format & loader** — the *contract* (a seed graph that compiles to a flat
  dag) is It. 1; the concrete serialized format + the loader/scanner are **It. 2** (host).
- **Backup / sharing stop-gap** — sacred `~/.radorc` DB backup vs. a git-shareable seed
  (It. 2 decision).
- **Service framework** and the CLI-as-client transport — parked, an It. 2 decision.
- **External-system integration** (Jira / GitHub Projects / company system of record),
  **provider config**, **teams** — schema-*reserved* in It. 2; the integrations themselves
  are a future initiative, not this one.
- **Autonomous steering** and **multi-project scheduling** — future, beyond this scope.

## Prior Explorations (now relevant, not stubs)

- **`DAG-PLAYBOOK`** — the Assemble / Instruct / Invent model and "Part 3: Plugins &
  sharing." This initiative is the engine foundation that makes Invent + the ecosystem
  real.
- **`CUSTOM-PIPELINE-STEP` / `CUSTOM-WORKFLOWS`** — prior custom-node thinking; they come
  home in the node-type contract (D18/D21) + templates-as-workflows (D20) + later
  node-type-loading iterations.
