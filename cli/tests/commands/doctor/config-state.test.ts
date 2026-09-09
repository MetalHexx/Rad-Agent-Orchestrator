import { describe, expect, it } from 'vitest';
import { runConfigStateChecks, type CheckResult } from '../../../src/commands/doctor/checks.js';
import type { ConfigResult } from '../../../src/commands/config/index.js';

describe('runConfigStateChecks', () => {
  // Helper to create a ConfigResult with sensible defaults
  function makeConfig(overrides?: Partial<ConfigResult>): ConfigResult {
    return {
      autoCommit: 'ask',
      autoPr: 'ask',
      telemetryEnabled: true,
      ambientVerbosity: 'verbose',
      communicationStyle: { enabled: false, selected: 'high-level.md' },
      ...overrides,
    };
  }

  function getCheckByName(results: CheckResult[], name: string): CheckResult | undefined {
    return results.find((r) => r.name === name);
  }

  // Test 1: Both enabled (both checks pass)
  it('passes when both telemetryEnabled and ambientVerbosity are at defaults', () => {
    const config = makeConfig({
      telemetryEnabled: true,
      ambientVerbosity: 'verbose',
    });
    const results = runConfigStateChecks(config);

    const tracking = getCheckByName(results, 'session-tracking-available');
    expect(tracking).toBeDefined();
    expect(tracking!.status).toBe('pass');
    expect(tracking!.category).toBe('Install');

    const activeTime = getCheckByName(results, 'session-active-time');
    expect(activeTime).toBeDefined();
    expect(activeTime!.status).toBe('pass');
    expect(activeTime!.category).toBe('Install');
  });

  // Test 2: ambientVerbosity === 'off' (session-tracking warns, session-active-time passes)
  it('warns on session-tracking-available when ambientVerbosity is off', () => {
    const config = makeConfig({
      telemetryEnabled: true,
      ambientVerbosity: 'off',
    });
    const results = runConfigStateChecks(config);

    const tracking = getCheckByName(results, 'session-tracking-available');
    expect(tracking).toBeDefined();
    expect(tracking!.status).toBe('warn');
    expect(tracking!.detail).toContain('ambient_awareness.verbosity');
    expect(tracking!.category).toBe('Install');

    const activeTime = getCheckByName(results, 'session-active-time');
    expect(activeTime).toBeDefined();
    expect(activeTime!.status).toBe('pass');
  });

  // Test 3: telemetryEnabled === false (session-active-time warns, session-tracking passes)
  it('warns on session-active-time when telemetryEnabled is false', () => {
    const config = makeConfig({
      telemetryEnabled: false,
      ambientVerbosity: 'verbose',
    });
    const results = runConfigStateChecks(config);

    const tracking = getCheckByName(results, 'session-tracking-available');
    expect(tracking).toBeDefined();
    expect(tracking!.status).toBe('pass');

    const activeTime = getCheckByName(results, 'session-active-time');
    expect(activeTime).toBeDefined();
    expect(activeTime!.status).toBe('warn');
    expect(activeTime!.detail).toBeDefined();
    expect(activeTime!.category).toBe('Install');
  });

  // Test 4: Both conditions present (both checks warn)
  it('warns on both checks when both telemetryEnabled is false and ambientVerbosity is off', () => {
    const config = makeConfig({
      telemetryEnabled: false,
      ambientVerbosity: 'off',
    });
    const results = runConfigStateChecks(config);

    const tracking = getCheckByName(results, 'session-tracking-available');
    expect(tracking).toBeDefined();
    expect(tracking!.status).toBe('warn');
    expect(tracking!.detail).toContain('ambient_awareness.verbosity');

    const activeTime = getCheckByName(results, 'session-active-time');
    expect(activeTime).toBeDefined();
    expect(activeTime!.status).toBe('warn');
    expect(activeTime!.detail).toBeDefined();
  });

  // Test other ambientVerbosity values still pass
  it('passes session-tracking-available for minimal verbosity', () => {
    const config = makeConfig({
      telemetryEnabled: true,
      ambientVerbosity: 'minimal',
    });
    const results = runConfigStateChecks(config);

    const tracking = getCheckByName(results, 'session-tracking-available');
    expect(tracking).toBeDefined();
    expect(tracking!.status).toBe('pass');
  });

  it('passes session-tracking-available for silent verbosity', () => {
    const config = makeConfig({
      telemetryEnabled: true,
      ambientVerbosity: 'silent',
    });
    const results = runConfigStateChecks(config);

    const tracking = getCheckByName(results, 'session-tracking-available');
    expect(tracking).toBeDefined();
    expect(tracking!.status).toBe('pass');
  });

  it('returns exactly two checks', () => {
    const config = makeConfig();
    const results = runConfigStateChecks(config);
    expect(results).toHaveLength(2);
  });

  it('both checks are never fail status', () => {
    const configs = [
      makeConfig({ telemetryEnabled: true, ambientVerbosity: 'verbose' }),
      makeConfig({ telemetryEnabled: true, ambientVerbosity: 'off' }),
      makeConfig({ telemetryEnabled: false, ambientVerbosity: 'verbose' }),
      makeConfig({ telemetryEnabled: false, ambientVerbosity: 'off' }),
    ];

    for (const config of configs) {
      const results = runConfigStateChecks(config);
      for (const check of results) {
        expect(check.status).not.toBe('fail');
      }
    }
  });
});
