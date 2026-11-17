/**
 * Monaco, bundled — not loaded from a CDN.
 *
 * Wires the official `monaco-editor` package into `@monaco-editor/react` and
 * configures real Web Workers through Vite's `?worker` imports so the editor
 * keeps full IntelliSense/validiation in dev, in the production web build, and
 * inside Electron (where the app is served over `file://`).
 *
 * `MonacoEnvironment.getWorker` returns the correct worker per language label.
 * Languages without a dedicated worker (Python, C/C++, Java, …) fall back to the
 * base editor worker, which still provides tokenization + bracket matching.
 */
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import { registerCustomLanguages } from '../languages/customLanguages.js';

import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case 'json':
        return new jsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker();
      case 'typescript':
      case 'javascript':
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

// Point the React wrapper at the bundled instance instead of the default CDN loader.
loader.config({ monaco });

// Real Monarch grammars + editor configs for the 16 languages Monaco does not
// bundle (Vue, Svelte, Astro, TOML, Makefile, Nginx, Haskell, OCaml, Erlang,
// Fortran, COBOL, Assembly, MATLAB, Groovy, WAT, PL/SQL). Guarded so a bad
// grammar can never break editor boot.
try {
  registerCustomLanguages(monaco);
} catch (err) {
  console.warn('Custom language registration skipped:', err);
}

// Enable Monaco's built-in JS/TS diagnostics (syntax + semantic) via its
// bundled language service. Other languages rely on the editor worker for
// tokenization/bracket-matching, and on the backend lint service for errors.
// Guarded so a Monaco API change can never white-screen the whole app at boot.
try {
  const tsCompilerOptions = { target: monaco.languages.typescript.ScriptTarget.ES2020, allowNonTsExtensions: true };
  const diagnosticsOptions = { noSemanticValidation: false, noSyntaxValidation: false };
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions(tsCompilerOptions);
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions(tsCompilerOptions);
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(diagnosticsOptions);
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(diagnosticsOptions);
} catch (err) {
  console.warn('Monaco TS/JS diagnostics configuration skipped:', err);
}

export { monaco };
export default monaco;
