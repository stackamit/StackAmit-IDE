import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { LANGUAGES, getLanguage } from '../src/config/languages.js';
import { RUNTIME_PROBES } from '../src/services/runtimes.js';
import { LINTABLE, commandFor } from '../src/services/lint.service.js';

/**
 * Live syntax checking is a second consumer of the same toolchain table as the
 * interactive runner — this file pins the two together so the lint command can
 * never drift from what detectRuntimes() actually proves.
 */

/** Keys where the lint tool IS the probed command (the runtime cmd is honoured). */
const SAME_TOOL = ['python', 'c', 'cpp', 'php', 'ruby', 'shell'];

describe('lint command registry parity', () => {
  test('every lintable language has a runtime probe and a registry entry', () => {
    for (const key of LINTABLE) {
      assert.ok(RUNTIME_PROBES[key], `${key} is lintable but never probed`);
      assert.ok(getLanguage(key), `${key} is lintable but not in the language registry`);
    }
  });

  test('the detected runtime command is used where it is the lint tool itself', () => {
    for (const key of SAME_TOOL) {
      const { cmd } = commandFor(key, 'x', { [key]: { available: true, cmd: 'detected-tool' } });
      assert.equal(cmd, 'detected-tool', `${key}: lint must spawn what detection proved`);
    }
  });

  test('javac and gofmt stay fixed on purpose (probe verifies a sibling tool)', () => {
    // detectRuntimes() proves `java` (+javac) and `go`; the lint step runs the
    // *other* executable, which those installs always ship together.
    assert.equal(commandFor('java', 'Main.java', { java: { available: true, cmd: 'java' } }).cmd, 'javac');
    assert.equal(commandFor('go', 'main.go', { go: { available: true, cmd: 'go' } }).cmd, 'gofmt');
  });

  test('fallbacks without a detected runtime name a probed candidate', () => {
    for (const key of SAME_TOOL) {
      const { cmd } = commandFor(key, 'x', {});
      assert.ok(
        RUNTIME_PROBES[key].cmds.includes(cmd),
        `${key}: lint fallback '${cmd}' is not in its probe list [${RUNTIME_PROBES[key].cmds.join(', ')}]`,
      );
    }
  });

  test('languages with no local check answer null instead of guessing a tool', () => {
    assert.equal(commandFor('ruby_but_unknown', 'x', {}), null);
    // Every registry language either is lintable or is explicitly not.
    const lintable = new Set(LINTABLE);
    for (const l of LANGUAGES) {
      if (lintable.has(l.key)) continue;
      assert.equal(commandFor(l.key, 'x', {}), null, `${l.key} must not gain a lint command silently`);
    }
  });
});
