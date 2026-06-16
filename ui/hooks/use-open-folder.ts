"use client";

export interface OpenFolderResult {
  success: boolean;
  error?: string;
}

/**
 * SC-PANEL-POLISH: ask the local server to reveal a repo folder in the OS
 * file explorer. Mirrors `postStartAction` — never throws; every failure mode
 * comes back as `{ success: false, error }`. The server validates the path.
 */
export async function postOpenFolder(
  projectName: string,
  folderPath: string,
): Promise<OpenFolderResult> {
  try {
    const res = await fetch(
      `/api/projects/${encodeURIComponent(projectName)}/open-folder`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: folderPath }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as OpenFolderResult;
    if (!res.ok) {
      return { success: false, error: json.error ?? `HTTP ${res.status}` };
    }
    return json;
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Request failed.",
    };
  }
}
