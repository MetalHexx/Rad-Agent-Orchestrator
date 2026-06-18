// Build the child env so the CLI authenticates with cached OAuth (the Max plan)
// rather than any metered credential. Claude Code's auth precedence is:
// cloud provider (Bedrock/Vertex) > ANTHROPIC_AUTH_TOKEN > ANTHROPIC_API_KEY >
// apiKeyHelper > CLAUDE_CODE_OAUTH_TOKEN > cached subscription OAuth. Removing
// everything that outranks the cached OAuth is the guarantee of zero API spend —
// this is what keeps us on the Max plan, independent of any CLI flags (NFR-1, AD-4).
const METERED_CREDENTIAL_VARS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
] as const;

export function buildChildEnv(parentEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv = { ...parentEnv };
  for (const key of METERED_CREDENTIAL_VARS) delete childEnv[key];
  return childEnv;
}
