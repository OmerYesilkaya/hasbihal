import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import bash from 'highlight.js/lib/languages/bash';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { createLowlight } from 'lowlight';
import type { ReactNode } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';

/** The curated language set of DECISIONS A48 (html is `xml`). Aliases like `ts` or `py` work too. */
const lowlight = createLowlight({
  bash,
  csharp,
  css,
  go,
  java,
  javascript,
  json,
  python,
  rust,
  shell,
  sql,
  typescript,
  xml,
  yaml,
});

/**
 * Highlighted code as React elements. lowlight returns a syntax tree, not HTML, so nothing goes
 * through innerHTML. Unknown or missing languages render as plain text: no guessing.
 */
export function highlight(code: string, language: string | null): ReactNode {
  if (!language || !lowlight.registered(language)) return code;
  // The library types its result as the global JSX.Element, which React 19 no longer declares.
  return toJsxRuntime(lowlight.highlight(language, code), { Fragment, jsx, jsxs }) as ReactNode;
}
