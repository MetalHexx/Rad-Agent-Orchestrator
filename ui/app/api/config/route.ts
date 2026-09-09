import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import path from 'node:path';
import { access, constants } from 'node:fs/promises';
import { getConfigPath, readConfigWithRaw, writeConfig } from '@/lib/fs-reader';
import { parseYaml, stringifyYaml } from '@/lib/yaml-parser';
import { validateConfig } from '@/lib/config-validator';
import { listStyleCatalog, resolveStyleCatalogRoot } from '@/lib/communication-styles-fs';
import type { ConfigPutRequest } from '@/types/config';

function knownStylePaths(): string[] | undefined {
  try {
    return listStyleCatalog(resolveStyleCatalogRoot()).map((s) => s.path);
  } catch {
    return undefined;
  }
}

export async function GET() {
  try {
    const { config, rawYaml } = await readConfigWithRaw();

    return NextResponse.json({ config, rawYaml }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  let body: ConfigPutRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (body.mode !== 'form' && body.mode !== 'raw') {
    return NextResponse.json(
      { error: 'Invalid mode — must be "form" or "raw"' },
      { status: 400 },
    );
  }

  let yamlString: string;

  if (body.mode === 'form') {
    if (!body.config) {
      return NextResponse.json(
        { error: 'Missing config object for form mode' },
        { status: 400 },
      );
    }

    let errors;
    try {
      errors = validateConfig(body.config, knownStylePaths());
    } catch {
      return NextResponse.json(
        { error: 'Invalid config structure' },
        { status: 400 },
      );
    }
    if (Object.keys(errors).length > 0) {
      return NextResponse.json(
        { error: 'Validation failed', details: errors },
        { status: 400 },
      );
    }

    yamlString = stringifyYaml(body.config);
  } else {
    if (typeof body.rawYaml !== 'string') {
      return NextResponse.json(
        { error: 'Missing rawYaml string for raw mode' },
        { status: 400 },
      );
    }

    let parsed: unknown;
    try {
      parsed = parseYaml(body.rawYaml);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `Invalid YAML: ${message}` },
        { status: 400 },
      );
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json(
        { error: 'YAML must be a mapping (object), not a scalar or array' },
        { status: 400 },
      );
    }

    yamlString = body.rawYaml;
  }

  // Pre-check: verify config file is writable
  const configPath = getConfigPath();
  try {
    await access(path.dirname(configPath), constants.W_OK);
  } catch {
    return NextResponse.json(
      { error: 'Configuration file is not writable — check file permissions or volume mount' },
      { status: 403 },
    );
  }

  try {
    await writeConfig(yamlString);
    const readBack = await readConfigWithRaw();
    return NextResponse.json(
      { success: true, config: readBack.config },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to write config: ${message}` },
      { status: 500 },
    );
  }
}