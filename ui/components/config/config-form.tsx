"use client";

import { Accordion } from "@/components/ui/accordion";
import { ConfigSection } from "@/components/config/config-section";
import { ConfigFieldRow } from "@/components/config/config-field-row";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CONFIG_FIELDS, type FieldMeta } from "@/lib/config-field-meta";
import type { OrchestrationConfig, ConfigValidationErrors } from "@/types/config";

interface ConfigFormProps {
  /** The current configuration object */
  config: OrchestrationConfig;
  /** Field-level validation errors keyed by dot-path */
  errors: ConfigValidationErrors;
  /** Callback when a field value changes — (dotPath, newValue) */
  onChange: (path: string, value: unknown) => void;
}

const SECTION_TITLES: Record<string, string> = {
  limits: "Pipeline Limits",
  "human-gates": "Human Gates",
  "source-control": "Source Control",
  template: "Template",
  telemetry: "Observability",
  ui: "Dashboard",
};

const SECTION_ORDER = ["limits", "human-gates", "source-control", "template", "telemetry", "ui"];

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc !== null && acc !== undefined && typeof acc === "object") {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

export function ConfigForm({ config, errors, onChange }: ConfigFormProps) {
  const versionField = CONFIG_FIELDS.find((f) => f.section === "version");
  const versionValue = versionField
    ? getNestedValue(config as unknown as Record<string, unknown>, versionField.key)
    : config.version;

  const fieldsBySection = new Map<string, FieldMeta[]>();
  for (const field of CONFIG_FIELDS) {
    if (field.section === "version") continue;
    const existing = fieldsBySection.get(field.section) ?? [];
    existing.push(field);
    fieldsBySection.set(field.section, existing);
  }

  function renderControl(field: FieldMeta) {
    const value = getNestedValue(
      config as unknown as Record<string, unknown>,
      field.key
    );

    switch (field.controlType) {
      case "text":
        return (
          <Input
            type="text"
            id={field.key}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(field.key, e.target.value)}
          />
        );

      case "number":
        return (
          <Input
            type="number"
            id={field.key}
            min={field.min}
            step="1"
            value={value as number ?? ""}
            onChange={(e) =>
              onChange(
                field.key,
                e.target.value === "" ? "" : Number(e.target.value)
              )
            }
          />
        );

      case "switch":
        return (
          <Switch
            id={field.key}
            checked={!!value}
            onCheckedChange={(checked) => onChange(field.key, checked)}
          />
        );

      case "toggle-group":
        return (
          <ToggleGroup
            id={field.key}
            value={typeof value === 'string' ? [value] : []}
            onValueChange={(newVal) => { if (newVal.length > 0) onChange(field.key, newVal[0]); }}
          >
            {field.options!.map((opt) => (
              <ToggleGroupItem key={opt} value={opt}>
                {opt}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        );

      case "readonly":
        return (
          <span id={field.key} className="text-sm text-muted-foreground">
            {String(value ?? "")}
          </span>
        );
    }
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground px-1 pb-2">
        Schema version: {String(versionValue)}
      </p>

      <Accordion
        multiple
        defaultValue={SECTION_ORDER}
      >
        {SECTION_ORDER.map((sectionKey) => {
          const fields = fieldsBySection.get(sectionKey);
          if (!fields) return null;

          return (
            <ConfigSection
              key={sectionKey}
              value={sectionKey}
              title={SECTION_TITLES[sectionKey]}
            >
              {fields.map((field) => (
                <ConfigFieldRow
                  key={field.key}
                  label={field.label}
                  tooltip={field.tooltip}
                  htmlFor={field.key}
                  error={errors[field.key]}
                >
                  {renderControl(field)}
                </ConfigFieldRow>
              ))}
            </ConfigSection>
          );
        })}
      </Accordion>
    </div>
  );
}
