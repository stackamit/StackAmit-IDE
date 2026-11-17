/**
 * Client-side mirror of the backend language registry.
 *
 * The list is *derived* from `languages/languageCapabilities.js` — every entry
 * the registry marks with a live-verified remote execution key — so the web
 * editor, the selector and the capability browser can never drift apart.
 * Starter programs live here (they are what the editor shows before
 * `GET /api/languages` resolves); the authoritative labels, versions and
 * starters still come from the API and override these at runtime.
 */
import { catalogueEntries } from '../languages/languageCapabilities.js';

/** Run key -> starter program (mirrors server/src/config/languages.js). */
const STARTERS = {
  python: `name = input()\nprint("Hello, " + name)\n`,
  c: `#include <stdio.h>\n\nint main(void) {\n    printf("Hello, World!\\n");\n    return 0;\n}\n`,
  cpp: `#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello, World!" << endl;\n    return 0;\n}\n`,
  java: `import java.util.Scanner;\n\nclass Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}\n`,
  javascript: `const input = require("fs").readFileSync(0, "utf8").trim();\nconsole.log("Hello, " + input);\n`,
  typescript: `const greet = (name: string): string => \`Hello, \${name}!\`;\n\nconsole.log(greet("World"));\n`,
  go: `package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello, World!")\n}\n`,
  rust: `use std::io::Read;\n\nfn main() {\n    let mut name = String::new();\n    std::io::stdin().read_to_string(&mut name).unwrap();\n    println!("Hello, {}!", name.trim());\n}\n`,
  csharp: `using System;\n\nclass Program {\n    static void Main() {\n        Console.WriteLine("Hello, World!");\n    }\n}\n`,
  php: `<?php\n$name = trim(fgets(STDIN));\necho "Hello, " . ($name !== '' ? $name : "World") . "\\n";\n`,
  ruby: `name = STDIN.gets.to_s.strip\nputs "Hello, #{name.empty? ? 'World' : name}"\n`,
  perl: `my $name = <STDIN> // '';\nchomp $name;\nprint "Hello, ", ($name eq '' ? 'World' : $name), "\\n";\n`,
  lua: `local name = io.read('*l') or ''\nprint('Hello, ' .. (name ~= '' and name or 'World'))\n`,
  julia: `name = readline()\nprintln("Hello, ", isempty(name) ? "World" : name)\n`,
  haskell: `main :: IO ()\nmain = do\n  name <- getLine\n  putStrLn ("Hello, " ++ (if null name then "World" else name))\n`,
  sql: `-- Runs against a fresh in-memory SQLite database.\nCREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\nINSERT INTO users (name) VALUES ('Ada'), ('Linus');\nSELECT name FROM users ORDER BY name;\n`,
  shell: `#!/usr/bin/env bash\nread -r name || true\nname="\${name:-World}"\necho "Hello, $name"\n`,
  pascal: `program Main;\nbegin\n  writeln('Hello, World!');\nend.\n`,
};

/** Starter file name the provider compiles under (mirrors the backend). */
const FILE_NAMES = {
  python: 'main.py',
  c: 'main.c',
  cpp: 'main.cpp',
  java: 'Main.java',
  javascript: 'main.js',
  typescript: 'main.ts',
  go: 'main.go',
  rust: 'main.rs',
  csharp: 'main.cs',
  php: 'main.php',
  ruby: 'main.rb',
  perl: 'main.pl',
  lua: 'main.lua',
  julia: 'main.jl',
  haskell: 'Main.hs',
  sql: 'main.sql',
  shell: 'main.sh',
  pascal: 'main.pas',
};

/**
 * Registry-driven, in registry order, variants excluded. A language only
 * appears here when its remote execution was verified against the live
 * provider — nothing here is guessed from "the grammar exists".
 */
export const DEFAULT_LANGUAGES = catalogueEntries()
  .filter((cap) => cap.run && !cap.variantOf && STARTERS[cap.run])
  .map((cap) => ({
    key: cap.run,
    label: cap.label,
    monaco: cap.monaco,
    version: null, // filled in by GET /api/languages (provider runtime label)
    fileName: FILE_NAMES[cap.run],
    starter: STARTERS[cap.run],
  }));

export const DEFAULT_LANGUAGE_KEY = 'python';

export function languageByKey(list, key) {
  return list.find((l) => l.key === key) || list[0];
}
