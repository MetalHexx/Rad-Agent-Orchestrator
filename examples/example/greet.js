export default {
  name: 'example:greet',
  dataSchema: {
    greeting: { kind: 'string', level: 'optional', description: 'What to say; defaults to "Hello Custom Bundle".' },
    spoken: { kind: 'boolean', level: 'computed', description: 'Set once the greeting has been spoken.' },
  },
  traits: [],
  capabilities: [],
  presentation: { label: 'Greet', description: 'A zero-capability custom greeting node.' },
  instructions: '# example:greet\n\nSpeak the greeting inline, then report completion. Requests no capabilities.',
  act(ctx) {
    const greeting = typeof ctx.data.greeting === 'string' ? ctx.data.greeting : 'Hello Custom Bundle';
    return { instructions: greeting, executor: 'orchestrator-inline' };
  },
  handle(ev) {
    if (ev.token !== 'example:greet.spoken' || ev.envelope.outcome !== 'ok') return {};
    return { dataChange: { spoken: true } };
  },
  projectStatus(data) {
    return data.spoken === true ? 'done' : 'not_started';
  },
};
