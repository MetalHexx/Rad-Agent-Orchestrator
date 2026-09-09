/**
 * A project directory name: begins with an uppercase letter or digit, then only
 * uppercase letters, digits, hyphens, and dots.
 *
 * This is an independent copy of `ui/lib/project-name.ts` — cross-module reach-ins
 * are forbidden, and `cli/` never imports `ui/`.
 *
 * This is a correctness guard, not a security boundary: agents already create
 * project folders directly during brainstorming, so recognizing this convention
 * introduces no new trust. What it buys is that a malformed name can't create a
 * junk directory the work-graph then lists as a real project — and, as a side
 * effect, a traversal-shaped argument is rejected before it becomes a path.
 */
const PROJECT_NAME_RE = /^[A-Z0-9][A-Z0-9.-]*$/;

export function isProjectDirName(name: string): boolean {
  return PROJECT_NAME_RE.test(name);
}
