// Build the child env so the CLI authenticates with cached OAuth (the Max plan)
// rather than a billed API key. Auth precedence puts ANTHROPIC_API_KEY above
// OAuth, so removing it is the guarantee of zero API spend (NFR-1, AD-4).
export function buildChildEnv(parentEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv = { ...parentEnv };
  delete childEnv.ANTHROPIC_API_KEY;
  return childEnv;
}
