const DATA_SCHEMA = {
    greeting: { kind: 'string', level: 'optional', description: 'What to say; defaults to "Hello Custom Bundle".' },
    spoken: { kind: 'boolean', level: 'computed', description: 'Set once the greeting has been spoken.' },
};
function act(ctx) {
    const greeting = typeof ctx.data.greeting === 'string' ? ctx.data.greeting : 'Hello Custom Bundle';
    return { instructions: greeting, executor: 'orchestrator-inline' };
}
function handle(ev) {
    if (ev.token !== 'example:greet.spoken' || ev.envelope.outcome !== 'ok')
        return {};
    return { dataChange: { spoken: true } };
}
function projectStatus(data) {
    return data.spoken === true ? 'done' : 'not_started';
}
const greet = {
    name: 'example:greet',
    dataSchema: DATA_SCHEMA,
    traits: [],
    capabilities: [],
    presentation: { label: 'Greet', description: 'A zero-capability custom greeting node.' },
    instructions: '# example:greet\n\nSpeak the greeting inline, then report completion. Requests no capabilities.',
    act,
    handle,
    projectStatus,
};
export default greet;
