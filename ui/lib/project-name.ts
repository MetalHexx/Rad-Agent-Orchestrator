/** A project directory name: begins with an uppercase letter or digit, then only
 *  uppercase letters, digits, hyphens, and dots. Dots are permitted (not required) —
 *  a large share of real projects carry version numbers. */
const PROJECT_NAME_RE = /^[A-Z0-9][A-Z0-9.-]*$/;

export function isProjectDirName(name: string): boolean {
  return PROJECT_NAME_RE.test(name);
}
