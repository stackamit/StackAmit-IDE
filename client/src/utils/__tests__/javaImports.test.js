import { describe, it, expect } from 'vitest';
import {
  stripJavaCommentsAndLiterals,
  extractImports,
  analyzeJavaImports,
} from '../javaImports.js';

/**
 * External-import detection is the front door of the whole feature: it decides
 * which Java files look like they need a library. It must therefore
 *  - find real `import` / `import static` / `import a.b.*` statements,
 *  - classify them as jdk / project / catalog / unknown,
 *  - never be fooled by an import that only appears inside a comment or string,
 *  - deduplicate the same import seen across several files (a multi-file project
 *    needs one dependency, not one per file).
 */

describe('stripJavaCommentsAndLiterals', () => {
  it('removes line, block, and text-block content', () => {
    const src = [
      'import java.util.List;',
      '// import com.evil.NotReal;',
      '/* import com.block.Comment; */',
      'String s = "import com.in.a.String;";',
      'String t = """',
      '  import com.in.text.block;',
      '  """;',
      'import com.real.Needs;',
    ].join('\n');
    const clean = stripJavaCommentsAndLiterals(src);
    expect(clean).toContain('import java.util.List;');
    expect(clean).toContain('import com.real.Needs;');
    expect(clean).not.toContain('NotReal');
    expect(clean).not.toContain('com.block.Comment');
    expect(clean).not.toContain('com.in.a.String');
    expect(clean).not.toContain('com.in.text.block');
  });
});

describe('extractImports', () => {
  it('captures ordinary, static, and wildcard imports', () => {
    const src = [
      'import java.util.List;',
      'import static org.junit.Assert.assertEquals;',
      'import com.google.common.collect.*;',
    ].join('\n');
    const got = extractImports(src).map((i) => i.fqn);
    expect(got).toContain('java.util.List');
    expect(got).toContain('org.junit.Assert.assertEquals');
    expect(got).toContain('com.google.common.collect');
  });

  it('ignores commented-out and string-embedded imports (req 4)', () => {
    const src = [
      '// import com.example.Comment;',
      '/* import com.example.Block; */',
      'System.out.println("import com.example.Literal;");',
      'import com.example.Live;',
    ].join('\n');
    const got = extractImports(src).map((i) => i.fqn);
    expect(got).toEqual(['com.example.Live']);
  });
});

describe('analyzeJavaImports classification', () => {
  it('classifies jdk, catalog, and unknown external imports (req 3)', () => {
    const analysis = analyzeJavaImports([
      {
        path: '/p/Main.java',
        content: [
          'package com.demo;',
          'import java.util.List;',                       // jdk
          'import com.mycompany.other.Helper;',           // project (own package tree)
          'import org.apache.commons.lang3.StringUtils;', // catalog -> commons-lang3
          'import com.acme.mystery.Thing;',               // unknown
          'public class Main {}',
        ].join('\n'),
      },
      // Declare the sibling package so "com.mycompany.other" is a project import.
      { path: '/p/other/Helper.java', content: 'package com.mycompany.other;\npublic class Helper {}' },
    ]);

    const kindOf = (fqn) => analysis.imports.find((r) => r.fqn === fqn)?.kind;
    expect(kindOf('java.util.List')).toBe('jdk');
    expect(kindOf('com.mycompany.other.Helper')).toBe('project');
    expect(kindOf('org.apache.commons.lang3.StringUtils')).toBe('catalog');
    expect(kindOf('com.acme.mystery.Thing')).toBe('unknown');

    // unresolved == everything the JDK/project does not already satisfy.
    expect(analysis.unresolved.map((r) => r.fqn).sort()).toEqual(
      ['com.acme.mystery.Thing', 'org.apache.commons.lang3.StringUtils'].sort(),
    );
  });

  it('attaches the matching catalog entry to a catalog import', () => {
    const analysis = analyzeJavaImports([
      { path: '/p/A.java', content: 'import com.google.common.collect.ImmutableList;\nclass A {}' },
    ]);
    const rec = analysis.catalog.find((r) => r.fqn === 'com.google.common.collect.ImmutableList');
    expect(rec).toBeTruthy();
    expect(rec.catalog.some((e) => e.artifactId === 'guava')).toBe(true);
  });

  it('treats javax/jdk/sun shipped packages as jdk, not external', () => {
    const analysis = analyzeJavaImports([
      {
        path: '/p/B.java',
        content: [
          'import javax.crypto.Cipher;',
          'import jdk.internal.util.SomeThing;',
          'import sun.misc.Unsafe;',
          'class B {}',
        ].join('\n'),
      },
    ]);
    expect(analysis.unresolved).toHaveLength(0);
    expect(analysis.jdk.map((r) => r.fqn).sort()).toEqual(
      ['jdk.internal.util.SomeThing', 'javax.crypto.Cipher', 'sun.misc.Unsafe'].sort(),
    );
  });

  it('deduplicates the same import across multiple files (req 10)', () => {
    const files = [
      { path: '/p/A.java', content: 'import org.apache.commons.lang3.StringUtils;\nclass A {}' },
      { path: '/p/B.java', content: 'import org.apache.commons.lang3.StringUtils;\nclass B {}' },
      { path: '/p/C.java', content: 'import org.apache.commons.lang3.*;\nclass C {}' },
    ];
    const analysis = analyzeJavaImports(files);
    const lang3 = analysis.imports.filter((r) => r.fqn.startsWith('org.apache.commons.lang3'));
    // The class import and the wildcard import are distinct records, but the two
    // identical class imports are one record listing both files.
    const dup = analysis.imports.find((r) => r.fqn === 'org.apache.commons.lang3.StringUtils');
    expect(dup.files.sort()).toEqual(['/p/A.java', '/p/B.java']);
    expect(lang3.length).toBeGreaterThanOrEqual(1);
  });

  it('returns an empty analysis for dependency-free Java (req 18)', () => {
    const analysis = analyzeJavaImports([
      {
        path: '/p/Hello.java',
        content: 'import java.util.ArrayList;\nimport java.util.List;\npublic class Hello { public static void main(String[] a){} }',
      },
    ]);
    expect(analysis.unresolved).toHaveLength(0);
    expect(analysis.catalog).toHaveLength(0);
    expect(analysis.unknown).toHaveLength(0);
  });
});
