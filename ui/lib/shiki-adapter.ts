import type { RehypeShikiOptions } from '@shikijs/rehype';

/**
 * Returns the options object for @shikijs/rehype.
 * Isolates shiki configuration from the React component layer.
 * If shiki is swapped for another highlighter, only this file changes.
 */
export function getShikiRehypeOptions(): RehypeShikiOptions {
  return {
    themes: {
      light: 'github-light',
      dark: 'github-dark',
    },
    defaultColor: false,
  };
}

/**
 * Highlight a code string using shiki's JS API.
 * Returns highlighted HTML with dual-theme CSS variables.
 */
export async function highlightCode(code: string, lang: string): Promise<string> {
  const { codeToHtml } = await import('shiki');
  try {
    return await codeToHtml(code, {
      lang,
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    });
  } catch {
    // Fallback if lang is not recognized
    return await codeToHtml(code, {
      lang: 'text',
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    });
  }
}
