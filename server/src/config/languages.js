/**
 * Canonical language registry for StackAmit-IDE.
 *
 * Every supported language declares, in one place:
 *   - the Monaco editor language id
 *   - the file name conventions each provider expects
 *   - provider-specific runtime identifiers (Piston + Wandbox)
 *   - a sensible starter program
 *
 * Adding a language means adding one object here — the editor, selector and
 * execution adapters all derive their behaviour from this registry.
 */

export const LANGUAGES = [
  {
    key: 'python',
    label: 'Python',
    monaco: 'python',
    fileName: 'main.py',
    starter: `name = input()
print("Hello, " + name)
`,
    piston: { language: 'python', version: '3.10.0', label: 'Python 3.10' },
    wandbox: { compiler: 'cpython-3.11.10', label: 'CPython 3.11' },
  },
  {
    key: 'c',
    label: 'C',
    monaco: 'c',
    fileName: 'main.c',
    starter: `#include <stdio.h>

int main(void) {
    printf("Hello, World!\\n");
    return 0;
}
`,
    piston: { language: 'c', version: '10.2.0', label: 'GCC 10.2' },
    wandbox: { compiler: 'gcc-13.2.0-c', label: 'GCC 13.2 (C)' },
  },
  {
    key: 'cpp',
    label: 'C++',
    monaco: 'cpp',
    fileName: 'main.cpp',
    starter: `#include <iostream>
using namespace std;

int main() {
    cout << "Hello, World!" << endl;
    return 0;
}
`,
    piston: { language: 'c++', version: '10.2.0', label: 'G++ 10.2' },
    wandbox: { compiler: 'gcc-13.2.0', label: 'G++ 13.2' },
  },
  {
    key: 'java',
    label: 'Java',
    monaco: 'java',
    fileName: 'Main.java',
    // Class is intentionally package-private (`class Main`) so the same
    // snippet compiles whether the provider names the file Main.java
    // (Piston) or prog.java (Wandbox).
    starter: `import java.util.Scanner;

class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        System.out.print("Enter a number: ");
        int n = scanner.hasNextInt() ? scanner.nextInt() : 0;
        System.out.println("You entered: " + n);
        scanner.close();
    }
}
`,
    piston: { language: 'java', version: '15.0.2', label: 'OpenJDK 15' },
    wandbox: { compiler: 'openjdk-jdk-21+35', label: 'OpenJDK 21' },
  },
  {
    key: 'javascript',
    label: 'JavaScript (Node.js)',
    monaco: 'javascript',
    fileName: 'main.js',
    starter: `const fs = require("fs");
const input = fs.readFileSync(0, "utf8").trim();
console.log("Hello, " + input);
`,
    piston: { language: 'javascript', version: '18.15.0', label: 'Node 18' },
    wandbox: { compiler: 'nodejs-20.17.0', label: 'Node 20' },
  },
  {
    key: 'typescript',
    label: 'TypeScript',
    monaco: 'typescript',
    fileName: 'main.ts',
    starter: `const greet = (name: string): string => \`Hello, \${name}!\`;

console.log(greet("World"));
`,
    // Both runtime ids were verified against the live provider catalogs:
    // Wandbox lists `typescript-5.6.2`; Piston's /runtimes lists
    // `typescript@5.0.3`. TypeScript is compiled before running, so type
    // errors surface as a genuine compile_error result.
    piston: { language: 'typescript', version: '5.0.3', label: 'TS 5.0' },
    wandbox: { compiler: 'typescript-5.6.2', label: 'TypeScript 5.6' },
  },
  // ---------------------------------------------------------------------------
  // The entries below were verified against the LIVE Wandbox catalog on
  // 2026-10-21 (each compiler id was probed with a real hello-world run).
  // `piston` is intentionally null wherever the public Piston catalog could not
  // be verified (it now requires an API key): the provider then reports the
  // language as unsupported instead of pretending. Languages whose Wandbox
  // images were broken during the probe (Swift, Elixir, Erlang, OCaml, Scala,
  // Mono) are deliberately NOT registered as runners at all.
  // ---------------------------------------------------------------------------
  {
    key: 'go',
    label: 'Go',
    monaco: 'go',
    fileName: 'main.go',
    starter: `package main

import "fmt"

func main() {
\tfmt.Println("Hello, World!")
}
`,
    piston: null,
    wandbox: { compiler: 'go-1.23.2', label: 'Go 1.23' },
  },
  {
    key: 'rust',
    label: 'Rust',
    monaco: 'rust',
    fileName: 'main.rs',
    starter: `use std::io::Read;

fn main() {
    let mut name = String::new();
    std::io::stdin().read_to_string(&mut name).unwrap();
    println!("Hello, {}!", name.trim());
}
`,
    piston: null,
    wandbox: { compiler: 'rust-1.82.0', label: 'Rustc 1.82' },
  },
  {
    key: 'csharp',
    label: 'C#',
    monaco: 'csharp',
    fileName: 'main.cs',
    starter: `using System;

class Program {
    static void Main() {
        Console.WriteLine("Hello, World!");
    }
}
`,
    piston: null,
    // dotnetcore-8.0.402's image is currently broken on the provider (file
    // size limit); 6.0.425 runs cleanly as of the 2026-10-21 probe.
    wandbox: { compiler: 'dotnetcore-6.0.425', label: '.NET 6 (C#)' },
  },
  {
    key: 'php',
    label: 'PHP',
    monaco: 'php',
    fileName: 'main.php',
    starter: `<?php
$name = trim(fgets(STDIN));
echo "Hello, " . ($name !== '' ? $name : "World") . "\\n";
`,
    piston: null,
    wandbox: { compiler: 'php-8.3.12', label: 'PHP 8.3' },
  },
  {
    key: 'ruby',
    label: 'Ruby',
    monaco: 'ruby',
    fileName: 'main.rb',
    starter: `name = STDIN.gets.to_s.strip
puts "Hello, #{name.empty? ? 'World' : name}"
`,
    piston: null,
    wandbox: { compiler: 'ruby-3.4.9', label: 'Ruby 3.4' },
  },
  {
    key: 'perl',
    label: 'Perl',
    monaco: 'perl',
    fileName: 'main.pl',
    starter: `my $name = <STDIN> // '';
chomp $name;
print "Hello, ", ($name eq '' ? 'World' : $name), "\\n";
`,
    piston: null,
    wandbox: { compiler: 'perl-5.42.0', label: 'Perl 5.42' },
  },
  {
    key: 'lua',
    label: 'Lua',
    monaco: 'lua',
    fileName: 'main.lua',
    starter: `local name = io.read('*l') or ''
print('Hello, ' .. (name ~= '' and name or 'World'))
`,
    piston: null,
    wandbox: { compiler: 'lua-5.4.7', label: 'Lua 5.4' },
  },
  {
    key: 'julia',
    label: 'Julia',
    monaco: 'julia',
    fileName: 'main.jl',
    starter: `name = readline()
println("Hello, ", isempty(name) ? "World" : name)
`,
    piston: null,
    wandbox: { compiler: 'julia-1.10.5', label: 'Julia 1.10' },
  },
  {
    key: 'haskell',
    label: 'Haskell',
    monaco: 'haskell',
    fileName: 'Main.hs',
    starter: `main :: IO ()
main = do
  name <- getLine
  putStrLn ("Hello, " ++ (if null name then "World" else name))
`,
    piston: null,
    wandbox: { compiler: 'ghc-9.10.1', label: 'GHC 9.10' },
  },
  {
    key: 'sql',
    label: 'SQL (SQLite)',
    monaco: 'sql',
    fileName: 'main.sql',
    starter: `-- Runs against a fresh in-memory SQLite database.
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
INSERT INTO users (name) VALUES ('Ada'), ('Linus');
SELECT name FROM users ORDER BY name;
`,
    piston: null,
    // The provider executes the script through the sqlite3 CLI; SELECT
    // output lands on stdout exactly like the local `sqlite3` tool.
    wandbox: { compiler: 'sqlite-3.46.1', label: 'SQLite 3.46' },
  },
  {
    key: 'shell',
    label: 'Shell (Bash)',
    monaco: 'shell',
    fileName: 'main.sh',
    starter: `#!/usr/bin/env bash
read -r name || true
name="\${name:-World}"
echo "Hello, \$name"
`,
    piston: null,
    // `bash` is a top-level Wandbox "compiler" (script executed by bash).
    wandbox: { compiler: 'bash', label: 'Bash' },
  },
  {
    key: 'pascal',
    label: 'Pascal',
    monaco: 'pascal',
    fileName: 'main.pas',
    starter: `program Main;
begin
  writeln('Hello, World!');
end.
`,
    piston: null,
    wandbox: { compiler: 'fpc-3.2.2', label: 'Free Pascal 3.2' },
  },
];

const byKey = new Map(LANGUAGES.map((l) => [l.key, l]));

export const LANGUAGE_KEYS = LANGUAGES.map((l) => l.key);

export function getLanguage(key) {
  return byKey.get(key);
}

export function isSupportedLanguage(key) {
  return byKey.has(key);
}

/**
 * Public metadata for GET /api/languages. Never exposes provider internals
 * beyond what the UI needs to render the selector.
 */
export function listLanguageMetadata(provider) {
  return LANGUAGES.map((l) => {
    const runtime = provider === 'piston' ? l.piston : provider === 'wandbox' ? l.wandbox : null;
    return {
      key: l.key,
      label: l.label,
      monaco: l.monaco,
      fileName: l.fileName,
      starter: l.starter,
      version: runtime ? runtime.label : null,
      runtimeId: runtime ? (runtime.version || runtime.compiler) : null,
    };
  });
}
