import { describe, it, expect } from 'vitest';
import { buildProgram } from '../../../src/cli.js';

describe('config noun registration', () => {
  it('registers `config` as a parent command', () => {
    const program = buildProgram('0.0.0-test');
    const config = program.commands.find((c) => c.name() === 'config');
    expect(config).toBeDefined();
  });

  it('registers a `get` subcommand whose description matches the prior config read behavior', () => {
    const program = buildProgram('0.0.0-test');
    const config = program.commands.find((c) => c.name() === 'config');
    const get = config!.commands.find((c) => c.name() === 'get');
    expect(get).toBeDefined();
    expect(get!.description()).toMatch(/auto_commit/);
  });

  it('registers a `set-verbosity` subcommand', () => {
    const program = buildProgram('0.0.0-test');
    const config = program.commands.find((c) => c.name() === 'config');
    const setVerbosity = config!.commands.find((c) => c.name() === 'set-verbosity');
    expect(setVerbosity).toBeDefined();
  });
});
