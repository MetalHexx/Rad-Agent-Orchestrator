import yaml from 'js-yaml';

export type ActionEventKind = 'action' | 'event';
export type ActionCategory = 'agent-spawn' | 'gate' | 'terminal' | 'source-control';

export interface AlternateOutcome {
  event: string;
  when: string;
  /** Flag-name → literal value that identifies THIS outcome. Flag names are the
   *  kebab-case CLI flag names used in the event's signal_payload. */
  values?: Record<string, string>;
}

export interface ActionFrontmatter {
  kind: 'action';
  name: string;
  title: string;
  description: string;
  category: ActionCategory;
  completion_event: string | null;
  /** Condition under which completion_event is the right outcome. Required when
   *  alternate_outcomes is non-empty; forbidden when it is empty or absent. */
  completion_when?: string;
  /** Every other way this step can finish by signalling. Defaults to []. */
  alternate_outcomes?: AlternateOutcome[];
  /** Who sends completion_event. 'skill' means no command is composed for this
   *  step — another skill signals it. Defaults to 'orchestrator'. */
  completion_signalled_by?: 'orchestrator' | 'skill';
}

export interface EventFrontmatter {
  kind: 'event';
  name: string;
  title: string;
  description: string;
  signal_payload: Record<string, {
    required: boolean;
    description: string;
    array?: boolean;
    /** Keys of each row of an array flag, in render order. Required when
     *  `array` is true, forbidden otherwise. */
    item_keys?: string[];
    /** The flag's value is JSON text. Its marker renders single-quoted, so the
     *  substituted JSON's own double quotes survive the shell. Mutually
     *  exclusive with `array`, which already renders a JSON skeleton. */
    json?: boolean;
  }>;
}

export type Frontmatter = ActionFrontmatter | EventFrontmatter;

export interface ParsedActionEvent {
  kind: ActionEventKind;
  name: string;
  frontmatter: Frontmatter;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const FILENAME_RE = /^(action|event)\.([a-z0-9_]+)\.md$/;
const CATEGORIES = new Set<ActionCategory>(['agent-spawn', 'gate', 'terminal', 'source-control']);

export function parseActionEventFile(text: string, filename: string): ParsedActionEvent {
  const fnMatch = FILENAME_RE.exec(filename);
  if (!fnMatch) {
    throw new Error(`Invalid catalog filename '${filename}': expected '<action|event>.<name>.md'.`);
  }
  const fileKind = fnMatch[1] as ActionEventKind;
  const fileName = fnMatch[2];

  const fmMatch = FRONTMATTER_RE.exec(text);
  if (!fmMatch) {
    throw new Error(`File '${filename}' missing YAML frontmatter block.`);
  }
  const raw = yaml.load(fmMatch[1]) as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') {
    throw new Error(`File '${filename}' has empty or non-object frontmatter.`);
  }

  if (raw['kind'] !== fileKind) {
    throw new Error(`File '${filename}' frontmatter.kind '${raw['kind']}' disagrees with filename kind '${fileKind}'.`);
  }
  if (raw['name'] !== fileName) {
    throw new Error(`File '${filename}' frontmatter.name '${raw['name']}' disagrees with filename stem '${fileName}'.`);
  }
  for (const field of ['title', 'description']) {
    if (typeof raw[field] !== 'string' || !(raw[field] as string).length) {
      throw new Error(`File '${filename}' frontmatter.${field} is required and must be a non-empty string.`);
    }
  }

  if (fileKind === 'action') {
    if (!CATEGORIES.has(raw['category'] as ActionCategory)) {
      throw new Error(`File '${filename}' frontmatter.category '${raw['category']}' is not one of ${[...CATEGORIES].join(', ')}.`);
    }
    if (!(raw['completion_event'] === null || typeof raw['completion_event'] === 'string')) {
      throw new Error(`File '${filename}' frontmatter.completion_event must be a string or null.`);
    }

    const NEW_ACTION_FIELDS = ['completion_when', 'alternate_outcomes', 'completion_signalled_by'] as const;
    if (raw['completion_event'] === null) {
      for (const field of NEW_ACTION_FIELDS) {
        if (raw[field] !== undefined) {
          throw new Error(`File '${filename}' frontmatter.${field} is forbidden when completion_event is null.`);
        }
      }
    } else {
      const completionWhen = raw['completion_when'];
      if (completionWhen !== undefined && (typeof completionWhen !== 'string' || completionWhen.length === 0)) {
        throw new Error(`File '${filename}' frontmatter.completion_when must be a non-empty string when present.`);
      }

      const alternateOutcomes = raw['alternate_outcomes'];
      if (alternateOutcomes !== undefined) {
        if (!Array.isArray(alternateOutcomes)) {
          throw new Error(`File '${filename}' frontmatter.alternate_outcomes must be an array when present.`);
        }
        alternateOutcomes.forEach((entry, index) => {
          const outcome = entry as Record<string, unknown> | null;
          if (!outcome || typeof outcome !== 'object' || typeof outcome['event'] !== 'string' || outcome['event'].length === 0) {
            throw new Error(`File '${filename}' frontmatter.alternate_outcomes[${index}].event is required and must be a non-empty string.`);
          }
          if (typeof outcome['when'] !== 'string' || outcome['when'].length === 0) {
            throw new Error(`File '${filename}' frontmatter.alternate_outcomes[${index}].when is required and must be a non-empty string.`);
          }
          if (outcome['values'] !== undefined) {
            const values = outcome['values'];
            if (typeof values !== 'object' || values === null || Array.isArray(values)) {
              throw new Error(`File '${filename}' frontmatter.alternate_outcomes[${index}].values must be an object when present.`);
            }
            for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
              if (typeof value !== 'string') {
                throw new Error(`File '${filename}' frontmatter.alternate_outcomes[${index}].values['${key}'] must be a string.`);
              }
            }
          }
        });
      }

      const hasAlternates = Array.isArray(alternateOutcomes) && alternateOutcomes.length > 0;
      if (hasAlternates && completionWhen === undefined) {
        throw new Error(`File '${filename}' frontmatter.completion_when is required when alternate_outcomes is non-empty.`);
      }
      if (!hasAlternates && completionWhen !== undefined) {
        throw new Error(`File '${filename}' frontmatter.completion_when is forbidden when alternate_outcomes is absent or empty.`);
      }

      const signalledBy = raw['completion_signalled_by'];
      if (signalledBy !== undefined) {
        if (signalledBy !== 'orchestrator' && signalledBy !== 'skill') {
          throw new Error(`File '${filename}' frontmatter.completion_signalled_by must be 'orchestrator' or 'skill' when present.`);
        }
        if (signalledBy === 'skill' && (completionWhen !== undefined || hasAlternates)) {
          throw new Error(`File '${filename}' frontmatter.completion_when and alternate_outcomes are forbidden when completion_signalled_by is 'skill'.`);
        }
      }
    }
  } else {
    const payload = raw['signal_payload'];
    if (payload === undefined || payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error(`File '${filename}' frontmatter.signal_payload must be an object map (use {} for no flags).`);
    }
    for (const [flag, def] of Object.entries(payload as Record<string, unknown>)) {
      const d = def as Record<string, unknown>;
      if (typeof d?.['required'] !== 'boolean' || typeof d?.['description'] !== 'string') {
        throw new Error(`File '${filename}' signal_payload['${flag}'] must be { required: boolean, description: string }.`);
      }
      if (d['array'] !== undefined && typeof d['array'] !== 'boolean') {
        throw new Error(`File '${filename}' signal_payload['${flag}'].array must be a boolean when present.`);
      }
      const itemKeys = d['item_keys'];
      if (d['array'] === true) {
        // item_keys is absent on catalogs installed before this field existed;
        // the renderer already treats an absent/empty list as a safe whole-flag
        // marker (completion-commands.ts renderArraySkeleton), so absence degrades
        // gracefully instead of breaking a pre-existing install. A *present but
        // malformed* item_keys is still a hard error.
        if (itemKeys !== undefined) {
          if (!Array.isArray(itemKeys) || !itemKeys.every((k) => typeof k === 'string' && k.length > 0)) {
            throw new Error(`File '${filename}' signal_payload['${flag}'].item_keys must be an array of non-empty strings when present.`);
          }
        }
      } else if (itemKeys !== undefined) {
        throw new Error(`File '${filename}' signal_payload['${flag}'].item_keys is forbidden when array is absent or false.`);
      }
      if (d['json'] !== undefined && typeof d['json'] !== 'boolean') {
        throw new Error(`File '${filename}' signal_payload['${flag}'].json must be a boolean when present.`);
      }
      if (d['json'] === true && d['array'] === true) {
        throw new Error(`File '${filename}' signal_payload['${flag}'] cannot set both array and json — an array flag already renders a JSON skeleton.`);
      }
    }
  }

  const body = fmMatch[2] ?? '';
  return { kind: fileKind, name: fileName, frontmatter: raw as unknown as Frontmatter, body };
}
