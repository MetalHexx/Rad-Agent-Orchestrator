import { readdir } from 'node:fs/promises';

import { isProjectDirName } from '@/lib/project-name';

/** Names of admitted project directories directly under `projectsDir`, per the shared rule. */
export async function discoverConnectedProjectNames(projectsDir: string): Promise<string[]> {
  const entries = await readdir(projectsDir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory() && isProjectDirName(e.name)).map((e) => e.name);
}
