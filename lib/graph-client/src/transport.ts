import { GraphClientError } from './errors.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface TransportConfig {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface RequestSpec {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly query?: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
}

type RawEnvelope = { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } };

function isEnvelopeShaped(value: unknown): value is RawEnvelope {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { ok?: unknown; error?: unknown };
  if (candidate.ok === true) {
    return true;
  }
  if (candidate.ok === false) {
    const error = candidate.error as { code?: unknown; message?: unknown } | undefined;
    return typeof error?.code === 'string' && typeof error?.message === 'string';
  }
  return false;
}

function buildUrl(baseUrl: string, path: string, query?: Readonly<Record<string, string | undefined>>): string {
  const url = new URL(path, baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
  }
  return url.toString();
}

/**
 * Issues one HTTP request, reads the service's `{ ok, data | error }` envelope, and returns
 * `data` — or throws a `GraphClientError`. The only place in the package that reads `ok`, so
 * every caller reaches domain and connectivity failures through one channel.
 */
export async function request<T>(cfg: TransportConfig, spec: RequestSpec): Promise<T> {
  const doFetch = cfg.fetch ?? fetch;
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = buildUrl(cfg.baseUrl, spec.path, spec.query);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await doFetch(url, {
      method: spec.method,
      ...(spec.body !== undefined
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(spec.body) }
        : {}),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new GraphClientError('timeout', `Request to ${url} timed out after ${timeoutMs}ms`, null);
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new GraphClientError('network_error', `Request to ${url} failed: ${message}`, null);
  } finally {
    clearTimeout(timer);
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new GraphClientError('bad_response', `Response from ${url} was not valid JSON`, response.status);
  }

  if (!isEnvelopeShaped(parsed)) {
    throw new GraphClientError('bad_response', `Response from ${url} was not a recognized envelope`, response.status);
  }

  if (parsed.ok) {
    return parsed.data as T;
  }
  throw new GraphClientError(parsed.error.code, parsed.error.message, response.status);
}
