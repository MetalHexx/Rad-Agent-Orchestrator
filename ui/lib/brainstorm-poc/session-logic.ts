// Pure session-id validation for the Brainstorm POC. No I/O, no globals.
// Session lifecycle is owned by the client now: it mints the UUID and passes a
// `resume` flag, so the server is a stateless executor (AD-6). The only thing
// the server still does is validate the id shape before interpolating it.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidSessionId(value: string): boolean {
  return UUID_RE.test(value.trim());
}
