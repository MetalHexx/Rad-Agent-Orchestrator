/** POSIX single-quoted literal escape: close, escape a literal `'`, reopen. */
export function quoteSingle(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * PowerShell single-quoted literal escape.
 *
 * Inside a PowerShell `'...'` literal, the only character that needs escaping
 * is the single quote itself — and PowerShell's rule is to double it (`''`),
 * not the POSIX close-escape-reopen form (`'\''`). Using POSIX inside an
 * encoded PowerShell payload silently corrupts paths or prompts that contain
 * `'`. This helper is the win32 counterpart to {@link quoteSingle}.
 */
export function quoteSinglePwsh(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
