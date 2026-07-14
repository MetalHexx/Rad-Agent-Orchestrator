import { describe, expect, it } from 'vitest';
import { request } from '../src/transport.js';
import { GraphClientError } from '../src/errors.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('request()', () => {
  it('returns `data` on a { ok: true } envelope', async () => {
    const stub = async () => jsonResponse(200, { ok: true, data: { hello: 'world' } });
    const result = await request<{ hello: string }>(
      { baseUrl: 'http://127.0.0.1:1', fetch: stub as typeof fetch },
      { method: 'GET', path: '/x' },
    );
    expect(result).toEqual({ hello: 'world' });
  });

  it('throws a GraphClientError with the mapped code + httpStatus on a { ok: false } envelope', async () => {
    const stub = async () => jsonResponse(404, { ok: false, error: { code: 'not_found', message: "node 'a' does not exist" } });
    let caught: unknown;
    try {
      await request(
        { baseUrl: 'http://127.0.0.1:1', fetch: stub as typeof fetch },
        { method: 'GET', path: '/x' },
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GraphClientError);
    expect((caught as GraphClientError).code).toBe('not_found');
    expect((caught as GraphClientError).message).toBe("node 'a' does not exist");
    expect((caught as GraphClientError).httpStatus).toBe(404);
  });

  it('throws network_error when the fetch call itself rejects', async () => {
    const stub = async () => {
      throw new Error('ECONNREFUSED');
    };
    let caught: unknown;
    try {
      await request({ baseUrl: 'http://127.0.0.1:1', fetch: stub as typeof fetch }, { method: 'GET', path: '/x' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GraphClientError);
    expect((caught as GraphClientError).code).toBe('network_error');
    expect((caught as GraphClientError).httpStatus).toBeNull();
  });

  it('throws timeout when the request aborts', async () => {
    const stub = (async (_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('This operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as typeof fetch;

    let caught: unknown;
    try {
      await request({ baseUrl: 'http://127.0.0.1:1', fetch: stub, timeoutMs: 5 }, { method: 'GET', path: '/x' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GraphClientError);
    expect((caught as GraphClientError).code).toBe('timeout');
    expect((caught as GraphClientError).httpStatus).toBeNull();
  });

  it('throws bad_response on a non-JSON body', async () => {
    const stub = async () => new Response('not json', { status: 200 });
    let caught: unknown;
    try {
      await request({ baseUrl: 'http://127.0.0.1:1', fetch: stub as typeof fetch }, { method: 'GET', path: '/x' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GraphClientError);
    expect((caught as GraphClientError).code).toBe('bad_response');
  });

  it('throws bad_response when the body is valid JSON but not envelope-shaped', async () => {
    const stub = async () => jsonResponse(200, { unexpected: true });
    let caught: unknown;
    try {
      await request({ baseUrl: 'http://127.0.0.1:1', fetch: stub as typeof fetch }, { method: 'GET', path: '/x' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GraphClientError);
    expect((caught as GraphClientError).code).toBe('bad_response');
  });

  it('sends the body JSON-encoded with a content-type header on a POST', async () => {
    let seenInit: RequestInit | undefined;
    const stub = (async (_url: string, init?: RequestInit) => {
      seenInit = init;
      return jsonResponse(200, { ok: true, data: null });
    }) as typeof fetch;

    await request(
      { baseUrl: 'http://127.0.0.1:1', fetch: stub },
      { method: 'POST', path: '/x', body: { project: 'p1', node: 'n1' } },
    );

    expect(seenInit?.method).toBe('POST');
    expect(seenInit?.body).toBe(JSON.stringify({ project: 'p1', node: 'n1' }));
    expect((seenInit?.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('carries the query map onto the request URL, dropping undefined entries', async () => {
    let seenUrl: string | undefined;
    const stub = (async (url: string) => {
      seenUrl = url;
      return jsonResponse(200, { ok: true, data: [] });
    }) as typeof fetch;

    await request(
      { baseUrl: 'http://127.0.0.1:1', fetch: stub },
      { method: 'GET', path: '/engine-graph/frontier', query: { project: 'p1', context: 'root', node: undefined } },
    );

    const parsed = new URL(seenUrl!);
    expect(parsed.searchParams.get('project')).toBe('p1');
    expect(parsed.searchParams.get('context')).toBe('root');
    expect(parsed.searchParams.has('node')).toBe(false);
  });
});
