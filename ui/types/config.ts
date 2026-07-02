// v3/ui/types/config.ts

/** Naming convention enum values */
export type NamingConvention = 'SCREAMING_CASE' | 'lowercase' | 'numbered';

/** Execution mode enum values */
export type ExecutionMode = 'ask' | 'phase' | 'task' | 'autonomous';

/** Source control action enum values */
export type SourceControlAction = 'always' | 'ask' | 'never';

/** Source control provider (currently fixed) */
export type SourceControlProvider = 'github';

/** Complete orchestration.yml schema — all sections required for the editor */
export interface OrchestrationConfig {
  version: string;
  limits: {
    max_retries_per_task: number;
  };
  human_gates: {
    after_planning: boolean;
    execution_mode: ExecutionMode;
    after_final_review: boolean;
  };
  source_control: {
    auto_commit: SourceControlAction;
    auto_pr: SourceControlAction;
  };
  default_template?: string;
  telemetry?: { enabled: boolean };
}

/** Editor mode */
export type ConfigEditorMode = 'form' | 'raw';

/** Field-level validation errors — key is dot-path (e.g. "limits.max_retries_per_task") */
export type ConfigValidationErrors = Record<string, string>;

/** Save state for the footer */
export type ConfigSaveState = 'idle' | 'saving' | 'success' | 'error';

/** API response for GET /api/config */
export interface ConfigGetResponse {
  config: OrchestrationConfig;
  rawYaml: string;
}

/** API request body for PUT /api/config */
export interface ConfigPutRequest {
  mode: ConfigEditorMode;
  config?: OrchestrationConfig;  // present when mode === 'form'
  rawYaml?: string;              // present when mode === 'raw'
}

/** API response for PUT /api/config */
export interface ConfigPutResponse {
  success: boolean;
  config: OrchestrationConfig;   // the saved config, parsed back
}

/** API error response */
export interface ConfigErrorResponse {
  error: string;
  details?: ConfigValidationErrors;
}
