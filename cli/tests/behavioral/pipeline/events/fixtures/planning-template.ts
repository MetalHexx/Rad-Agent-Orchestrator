// cli/tests/behavioral/pipeline/events/fixtures/planning-template.ts
export const PLANNING_TEMPLATE_BODY = `template:
  id: syn-planning
  version: "1.0.0"
  description: "Synthetic planning-only template for behavioral tests"
nodes:
  - id: master_plan
    kind: step
    label: "Master Plan"
    action: spawn_master_plan
    events: { completed: master_plan_completed }
    context: { step: master_plan }
    doc_output_field: doc_path
    depends_on: []
  - id: explode_master_plan
    kind: step
    label: "Explode Master Plan"
    action: explode_master_plan
    events: { completed: explosion_completed }
    context: { step: explode_master_plan }
    depends_on: [master_plan]
  - id: plan_approval_gate
    kind: gate
    label: "Plan Approval Gate"
    mode_ref: human_gates.after_planning
    action_if_needed: request_plan_approval
    approved_event: plan_approved
    auto_approve_modes: []
    depends_on: [explode_master_plan]
`;
