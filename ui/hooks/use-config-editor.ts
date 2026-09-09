"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  OrchestrationConfig,
  ConfigSaveState,
  ConfigValidationErrors,
  ConfigGetResponse,
  ConfigPutRequest,
  ConfigPutResponse,
} from "@/types/config";
import { validateConfig } from "@/lib/config-validator";

interface StyleOption { value: string; label: string }

export interface UseConfigEditorReturn {
  /** Panel open/close */
  isOpen: boolean;
  open: () => void;
  close: () => void;

  /** Load state */
  loading: boolean;
  loadError: string | null;
  retry: () => void;

  /** Form state (structured) */
  config: OrchestrationConfig | null;
  updateField: (path: string, value: unknown) => void;

  /** Runtime-sourced options for the Communication Style 'select' field */
  styleOptions: StyleOption[];

  /** Validation */
  errors: ConfigValidationErrors;

  /** Dirty tracking */
  isDirty: boolean;

  /** Save */
  saveState: ConfigSaveState;
  saveError: string | null;
  save: () => Promise<void>;

  /** Dismiss save error — resets saveState to idle and saveError to null */
  dismissSaveError: () => void;
}

export function useConfigEditor(): UseConfigEditorReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [config, setConfig] = useState<OrchestrationConfig | null>(null);
  const [styleOptions, setStyleOptions] = useState<StyleOption[]>([]);
  const [saveState, setSaveState] = useState<ConfigSaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [errors, setErrors] = useState<ConfigValidationErrors>({});

  // Baseline ref for dirty tracking
  const baselineConfigRef = useRef<string>("");

  // Abort controller for fetch cancellation
  const abortControllerRef = useRef<AbortController | null>(null);

  // Success timeout ref for the 2-second auto-reset timer
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup on unmount: clear timeout and abort in-flight request
  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const fetchStyleOptions = useCallback(async (signal: AbortSignal) => {
    try {
      const res = await fetch("/api/communication-styles", { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { styles: { path: string; title: string }[] };
      if (!signal.aborted) {
        setStyleOptions(json.styles.map((s) => ({ value: s.path, label: s.title })));
      }
    } catch {
      if (!signal.aborted) setStyleOptions([]);
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    // Abort any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    void fetchStyleOptions(controller.signal);

    try {
      const res = await fetch("/api/config", { signal: controller.signal });
      if (!res.ok) {
        const body = await res
          .json()
          .catch(() => ({ error: "Failed to load config" }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as ConfigGetResponse;
      if (!controller.signal.aborted) {
        setConfig(json.config);
        baselineConfigRef.current = JSON.stringify(json.config);
        const validationErrors = validateConfig(json.config);
        setErrors(validationErrors);
        setLoading(false);
      }
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      setLoadError(
        err instanceof Error ? err.message : "Failed to load config"
      );
      setLoading(false);
    }
  }, [fetchStyleOptions]);

  const open = useCallback(() => {
    setIsOpen(true);
    setConfig(null);
    setStyleOptions([]);
    setErrors({});
    setLoadError(null);
    setSaveState("idle");
    setSaveError(null);
    setLoading(true);
    fetchConfig();
  }, [fetchConfig]);

  const close = useCallback(() => {
    setIsOpen(false);
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
      successTimeoutRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  const retry = useCallback(() => {
    setLoadError(null);
    setLoading(true);
    fetchConfig();
  }, [fetchConfig]);

  const updateField = useCallback(
    (path: string, value: unknown) => {
      if (!config) return;
      const clone = JSON.parse(
        JSON.stringify(config)
      ) as Record<string, unknown>;
      const keys = path.split(".").filter(Boolean);
      if (keys.length === 0) return;
      let current: Record<string, unknown> = clone;
      for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i] as string;
        let next = current[key];
        if (
          next === undefined ||
          next === null ||
          typeof next !== "object" ||
          Array.isArray(next)
        ) {
          next = {};
          current[key] = next;
        }
        current = next as Record<string, unknown>;
      }
      current[keys[keys.length - 1] as string] = value;
      const updatedConfig = clone as unknown as OrchestrationConfig;
      setConfig(updatedConfig);
      setErrors(validateConfig(updatedConfig));
    },
    [config]
  );

  const dismissSaveError = useCallback(() => {
    setSaveState("idle");
    setSaveError(null);
  }, []);

  const save = useCallback(async () => {
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
      successTimeoutRef.current = null;
    }

    if (!config) return;
    const validationErrors = validateConfig(config);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setSaveState("saving");
    setSaveError(null);

    const body: ConfigPutRequest = { mode: "form", config };

    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res
          .json()
          .catch(() => ({ error: "Save failed" }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const json = (await res.json()) as ConfigPutResponse;
      const updatedConfig = json.config;
      setConfig(updatedConfig);
      baselineConfigRef.current = JSON.stringify(updatedConfig);

      setSaveState("success");
      successTimeoutRef.current = setTimeout(() => {
        setSaveState("idle");
        successTimeoutRef.current = null;
      }, 2000);
    } catch (err: unknown) {
      setSaveState("error");
      setSaveError(err instanceof Error ? err.message : "Save failed");
    }
  }, [config]);

  // Compute isDirty on each render
  const isDirty = config !== null && JSON.stringify(config) !== baselineConfigRef.current;

  return {
    isOpen,
    open,
    close,
    loading,
    loadError,
    retry,
    config,
    updateField,
    styleOptions,
    errors,
    isDirty,
    saveState,
    saveError,
    save,
    dismissSaveError,
  };
}
