// cli/tests/behavioral/pipeline/events/fixtures/execution-template.ts
// Synthetic single-phase, single-task execution template for behavioral tests.
// NFR-5: state-shape changes are coordinated — update seeded states in each
// test file when this template changes.
//
// Four template-body shapes are exported, covering every shape the
// final-scope-corrective requirement calls out:
//   - EXECUTION_TEMPLATE_BODY — the default body: final_review declares
//     `hosts_correctives: true`, and the task-loop body is
//     task_gate → task_executor → code_review. Used by the bulk of the
//     existing behavioral suite (unchanged apart from the new declaration).
//   - EXECUTION_TEMPLATE_BODY_NO_DECLARATION — identical to the default,
//     except final_review carries NO `hosts_correctives` key at all. Stands
//     in for the permanent state of every project already in flight when
//     this feature shipped: its per-project template snapshot predates the
//     declaration and never self-heals. The only trigger for the
//     undeclared-host halt (see mutations.ts FINAL_REVIEW_COMPLETED).
//   - EXECUTION_TEMPLATE_BODY_LOWER_TIER — final_review still declares
//     `hosts_correctives: true`, but the task-loop body is task_executor
//     ONLY (no task_gate, no code_review) — mirroring a low-tier project
//     template with no code-review step. Pins that a step-hosted corrective
//     closes after a single attempt (task_executor alone) rather than
//     waiting forever on a review step the template never declared.
//   - EXECUTION_TEMPLATE_BODY_WITH_PR_GATE — mirrors the shipped runtime
//     templates' `pr_gate` conditional (runtime-config/templates/high.yml),
//     placing a `kind: conditional` node between `final_review` and
//     `final_approval_gate` whose `true` branch hosts the `final_pr` step.
//     Proves a step-hosted final corrective's closure resolves into the
//     actual PR conditional, not just a proxy gate.
export const EXECUTION_TEMPLATE_BODY = `template:
  id: syn-exec
  version: "1.0.0"
  description: "Synthetic execution template for behavioral tests"
nodes:
  - id: gate_mode_selection
    kind: gate
    label: "Gate Mode Selection"
    mode_ref: human_gates.execution_mode
    action_if_needed: gate_task
    approved_event: gate_mode_set
    auto_approve_modes: [task, phase, autonomous]
    depends_on: []
  - id: phase_loop
    kind: for_each_phase
    label: "Phase Execution Loop"
    source_doc_ref: "$.nodes.master_plan.doc_path"
    total_field: total_phases
    depends_on: [gate_mode_selection]
    body:
      - id: task_loop
        kind: for_each_task
        label: "Task Execution Loop"
        source_doc_ref: "$.current_phase.doc_path"
        tasks_field: tasks
        depends_on: []
        body:
          - id: task_gate
            kind: gate
            label: "Task Gate"
            mode_ref: human_gates.execution_mode
            action_if_needed: gate_task
            approved_event: task_gate_approved
            auto_approve_modes: [phase, autonomous]
            depends_on: []
          - id: task_executor
            kind: step
            label: "Execute Task"
            action: execute_task
            events: { completed: task_completed }
            depends_on: [task_gate]
          - id: code_review
            kind: step
            label: "Code Review"
            action: spawn_code_reviewer
            events: { completed: code_review_completed }
            doc_output_field: doc_path
            depends_on: [task_executor]
      - id: phase_gate
        kind: gate
        label: "Phase Gate"
        mode_ref: human_gates.execution_mode
        action_if_needed: gate_phase
        approved_event: phase_gate_approved
        auto_approve_modes: [task, autonomous]
        depends_on: [task_loop]
      - id: phase_review
        kind: step
        label: "Phase Review"
        action: spawn_phase_reviewer
        events: { completed: phase_review_completed }
        doc_output_field: doc_path
        depends_on: [phase_gate]
  - id: final_review
    kind: step
    label: "Final Review"
    action: spawn_final_reviewer
    events: { completed: final_review_completed }
    doc_output_field: doc_path
    hosts_correctives: true
    depends_on: [phase_loop]
  - id: final_approval_gate
    kind: gate
    label: "Final Approval Gate"
    mode_ref: human_gates.after_final_review
    action_if_needed: request_final_approval
    approved_event: final_approved
    auto_approve_modes: []
    depends_on: [final_review]
`;

// Identical to EXECUTION_TEMPLATE_BODY except final_review carries no
// `hosts_correctives` key — the stale per-project snapshot shape.
export const EXECUTION_TEMPLATE_BODY_NO_DECLARATION = `template:
  id: syn-exec
  version: "1.0.0"
  description: "Synthetic execution template for behavioral tests (no hosts_correctives declaration)"
nodes:
  - id: gate_mode_selection
    kind: gate
    label: "Gate Mode Selection"
    mode_ref: human_gates.execution_mode
    action_if_needed: gate_task
    approved_event: gate_mode_set
    auto_approve_modes: [task, phase, autonomous]
    depends_on: []
  - id: phase_loop
    kind: for_each_phase
    label: "Phase Execution Loop"
    source_doc_ref: "$.nodes.master_plan.doc_path"
    total_field: total_phases
    depends_on: [gate_mode_selection]
    body:
      - id: task_loop
        kind: for_each_task
        label: "Task Execution Loop"
        source_doc_ref: "$.current_phase.doc_path"
        tasks_field: tasks
        depends_on: []
        body:
          - id: task_gate
            kind: gate
            label: "Task Gate"
            mode_ref: human_gates.execution_mode
            action_if_needed: gate_task
            approved_event: task_gate_approved
            auto_approve_modes: [phase, autonomous]
            depends_on: []
          - id: task_executor
            kind: step
            label: "Execute Task"
            action: execute_task
            events: { completed: task_completed }
            depends_on: [task_gate]
          - id: code_review
            kind: step
            label: "Code Review"
            action: spawn_code_reviewer
            events: { completed: code_review_completed }
            doc_output_field: doc_path
            depends_on: [task_executor]
      - id: phase_gate
        kind: gate
        label: "Phase Gate"
        mode_ref: human_gates.execution_mode
        action_if_needed: gate_phase
        approved_event: phase_gate_approved
        auto_approve_modes: [task, autonomous]
        depends_on: [task_loop]
      - id: phase_review
        kind: step
        label: "Phase Review"
        action: spawn_phase_reviewer
        events: { completed: phase_review_completed }
        doc_output_field: doc_path
        depends_on: [phase_gate]
  - id: final_review
    kind: step
    label: "Final Review"
    action: spawn_final_reviewer
    events: { completed: final_review_completed }
    doc_output_field: doc_path
    depends_on: [phase_loop]
  - id: final_approval_gate
    kind: gate
    label: "Final Approval Gate"
    mode_ref: human_gates.after_final_review
    action_if_needed: request_final_approval
    approved_event: final_approved
    auto_approve_modes: []
    depends_on: [final_review]
`;

// Same task-loop shape as the default body, but with a real `pr_gate`
// conditional (mirroring runtime-config/templates/high.yml) between
// `final_review` and `final_approval_gate`.
export const EXECUTION_TEMPLATE_BODY_WITH_PR_GATE = `template:
  id: syn-exec
  version: "1.0.0"
  description: "Synthetic execution template with a PR conditional for behavioral tests"
nodes:
  - id: gate_mode_selection
    kind: gate
    label: "Gate Mode Selection"
    mode_ref: human_gates.execution_mode
    action_if_needed: gate_task
    approved_event: gate_mode_set
    auto_approve_modes: [task, phase, autonomous]
    depends_on: []
  - id: phase_loop
    kind: for_each_phase
    label: "Phase Execution Loop"
    source_doc_ref: "$.nodes.master_plan.doc_path"
    total_field: total_phases
    depends_on: [gate_mode_selection]
    body:
      - id: task_loop
        kind: for_each_task
        label: "Task Execution Loop"
        source_doc_ref: "$.current_phase.doc_path"
        tasks_field: tasks
        depends_on: []
        body:
          - id: task_gate
            kind: gate
            label: "Task Gate"
            mode_ref: human_gates.execution_mode
            action_if_needed: gate_task
            approved_event: task_gate_approved
            auto_approve_modes: [phase, autonomous]
            depends_on: []
          - id: task_executor
            kind: step
            label: "Execute Task"
            action: execute_task
            events: { completed: task_completed }
            depends_on: [task_gate]
          - id: code_review
            kind: step
            label: "Code Review"
            action: spawn_code_reviewer
            events: { completed: code_review_completed }
            doc_output_field: doc_path
            depends_on: [task_executor]
      - id: phase_gate
        kind: gate
        label: "Phase Gate"
        mode_ref: human_gates.execution_mode
        action_if_needed: gate_phase
        approved_event: phase_gate_approved
        auto_approve_modes: [task, autonomous]
        depends_on: [task_loop]
      - id: phase_review
        kind: step
        label: "Phase Review"
        action: spawn_phase_reviewer
        events: { completed: phase_review_completed }
        doc_output_field: doc_path
        depends_on: [phase_gate]
  - id: final_review
    kind: step
    label: "Final Review"
    action: spawn_final_reviewer
    events: { completed: final_review_completed }
    doc_output_field: doc_path
    hosts_correctives: true
    depends_on: [phase_loop]
  - id: pr_gate
    kind: conditional
    label: "Auto-PR Gate"
    condition:
      state_ref: pipeline.source_control.auto_pr
      operator: neq
      value: never
    branches:
      true:
        - id: final_pr
          kind: step
          label: "Source Control PR"
          action: invoke_source_control_pr
          events: { started: pr_requested, completed: pr_created }
          depends_on: []
      false: []
    depends_on: [final_review]
  - id: final_approval_gate
    kind: gate
    label: "Final Approval Gate"
    mode_ref: human_gates.after_final_review
    action_if_needed: request_final_approval
    approved_event: final_approved
    auto_approve_modes: []
    depends_on: [pr_gate]
`;

// Lower-tier template: final_review still declares `hosts_correctives: true`,
// but the task-loop body is task_executor ONLY (no task_gate, no
// code_review) — the shape a lower project tier authors when it skips a
// dedicated code-review step. A step-hosted corrective born off this
// template must close after task_executor alone (single-attempt closure),
// not stall waiting on a review step the template never declared.
export const EXECUTION_TEMPLATE_BODY_LOWER_TIER = `template:
  id: syn-exec
  version: "1.0.0"
  description: "Synthetic lower-tier execution template for behavioral tests (task_executor-only body)"
nodes:
  - id: gate_mode_selection
    kind: gate
    label: "Gate Mode Selection"
    mode_ref: human_gates.execution_mode
    action_if_needed: gate_task
    approved_event: gate_mode_set
    auto_approve_modes: [task, phase, autonomous]
    depends_on: []
  - id: phase_loop
    kind: for_each_phase
    label: "Phase Execution Loop"
    source_doc_ref: "$.nodes.master_plan.doc_path"
    total_field: total_phases
    depends_on: [gate_mode_selection]
    body:
      - id: task_loop
        kind: for_each_task
        label: "Task Execution Loop"
        source_doc_ref: "$.current_phase.doc_path"
        tasks_field: tasks
        depends_on: []
        body:
          - id: task_executor
            kind: step
            label: "Execute Task"
            action: execute_task
            events: { completed: task_completed }
            depends_on: []
      - id: phase_gate
        kind: gate
        label: "Phase Gate"
        mode_ref: human_gates.execution_mode
        action_if_needed: gate_phase
        approved_event: phase_gate_approved
        auto_approve_modes: [task, autonomous]
        depends_on: [task_loop]
      - id: phase_review
        kind: step
        label: "Phase Review"
        action: spawn_phase_reviewer
        events: { completed: phase_review_completed }
        doc_output_field: doc_path
        depends_on: [phase_gate]
  - id: final_review
    kind: step
    label: "Final Review"
    action: spawn_final_reviewer
    events: { completed: final_review_completed }
    doc_output_field: doc_path
    hosts_correctives: true
    depends_on: [phase_loop]
  - id: final_approval_gate
    kind: gate
    label: "Final Approval Gate"
    mode_ref: human_gates.after_final_review
    action_if_needed: request_final_approval
    approved_event: final_approved
    auto_approve_modes: []
    depends_on: [final_review]
`;
