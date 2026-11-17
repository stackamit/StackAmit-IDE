/**
 * Snippet completions for languages that have NO bundled language service in
 * this build (the capability registry marks them `snippets: true`).
 *
 * These are registered through Monaco's real CompletionItemProvider API and
 * inserted with InsertAsSnippet rules, so tab stops (`$1`) and placeholders
 * behave exactly like VS Code snippets. They are deliberately NOT offered for
 * TypeScript/JavaScript/JSON/CSS/HTML — those already get genuine
 * language-service intelligence from their workers, and extra keyword noise
 * would degrade it.
 */
import { readPrefs } from '../hooks/useEditorPrefs.js';

const SNIPPETS = {
  python: [
    { prefix: 'def', label: 'function definition', body: 'def ${1:name}(${2:args}):\n    ${0:pass}' },
    { prefix: 'class', label: 'class definition', body: 'class ${1:Name}:\n    def __init__(self${2:, args}):\n        ${0:pass}' },
    { prefix: 'if', label: 'if block', body: 'if ${1:condition}:\n    ${0:pass}' },
    { prefix: 'for', label: 'for loop', body: 'for ${1:item} in ${2:iterable}:\n    ${0:pass}' },
    { prefix: 'while', label: 'while loop', body: 'while ${1:condition}:\n    ${0:pass}' },
    { prefix: 'try', label: 'try / except', body: 'try:\n    ${1:pass}\nexcept ${2:Exception} as ${3:e}:\n    ${0:raise}' },
    { prefix: 'main', label: 'main guard', body: 'if __name__ == "__main__":\n    ${0:main()}' },
    { prefix: 'print', label: 'print()', body: 'print(${1:value})' },
    { prefix: 'comp', label: 'list comprehension', body: '[${1:expr} for ${2:item} in ${3:iterable}]' },
  ],
  c: [
    { prefix: 'main', label: 'main function', body: '#include <stdio.h>\n\nint main(void) {\n    ${0}\n    return 0;\n}' },
    { prefix: 'for', label: 'for loop', body: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n    ${0}\n}' },
    { prefix: 'printf', label: 'printf', body: 'printf("${1:%d}\\n"${2:, ${3:value}});' },
    { prefix: 'if', label: 'if block', body: 'if (${1:condition}) {\n    ${0}\n}' },
  ],
  cpp: [
    { prefix: 'main', label: 'main function', body: '#include <iostream>\n\nint main() {\n    ${0}\n    return 0;\n}' },
    { prefix: 'class', label: 'class', body: 'class ${1:Name} {\npublic:\n    ${1:Name}() {}\n\nprivate:\n    ${0}\n};' },
    { prefix: 'for', label: 'range-for', body: 'for (auto& ${1:item} : ${2:container}) {\n    ${0}\n}' },
    { prefix: 'cout', label: 'std::cout', body: 'std::cout << ${1:value} << std::endl;' },
  ],
  java: [
    { prefix: 'main', label: 'main method', body: 'public static void main(String[] args) {\n    ${0}\n}' },
    { prefix: 'class', label: 'class', body: 'public class ${1:Name} {\n    ${0}\n}' },
    { prefix: 'sout', label: 'System.out.println', body: 'System.out.println(${1:value});' },
    { prefix: 'for', label: 'for loop', body: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n    ${0}\n}' },
    { prefix: 'try', label: 'try / catch', body: 'try {\n    ${1}\n} catch (${2:Exception} ${3:e}) {\n    ${0:e.printStackTrace();}\n}' },
  ],
  csharp: [
    { prefix: 'main', label: 'entry point', body: 'using System;\n\nclass Program {\n    static void Main(string[] args) {\n        ${0}\n    }\n}' },
    { prefix: 'class', label: 'class', body: 'public class ${1:Name} {\n    ${0}\n}' },
    { prefix: 'prop', label: 'auto property', body: 'public ${1:string} ${2:Name} { get; set; }' },
    { prefix: 'console', label: 'Console.WriteLine', body: 'Console.WriteLine(${1:value});' },
  ],
  markdown: [
    { prefix: 'link', label: 'link', body: '[${1:text}](${2:url})' },
    { prefix: 'img', label: 'image', body: '![${1:alt}](${2:url})' },
    { prefix: 'code', label: 'fenced code block', body: '```${1:lang}\n${0}\n```' },
    { prefix: 'table', label: 'table', body: '| ${1:Column 1} | ${2:Column 2} |\n| --- | --- |\n| ${3:cell} | ${4:cell} |' },
  ],
  go: [
    { prefix: 'main', label: 'main function', body: 'package main\n\nimport "fmt"\n\nfunc main() {\n\t${0:fmt.Println("Hello, world!")}\n}' },
    { prefix: 'func', label: 'function', body: 'func ${1:name}(${2:args}) ${3:error} {\n\t${0}\n}' },
    { prefix: 'for', label: 'for loop', body: 'for ${1:i} := 0; ${1:i} < ${2:n}; ${1:i}++ {\n\t${0}\n}' },
    { prefix: 'range', label: 'range loop', body: 'for ${1:i}, ${2:v} := range ${3:coll} {\n\t${0}\n}' },
    { prefix: 'if', label: 'error check', body: 'if ${1:err} != nil {\n\treturn ${1:err}\n}\n${0}' },
    { prefix: 'struct', label: 'struct type', body: 'type ${1:Name} struct {\n\t${2:Field} ${3:string}\n}' },
  ],
  rust: [
    { prefix: 'main', label: 'main function', body: 'fn main() {\n    ${0:println!("Hello, world!");}\n}' },
    { prefix: 'fn', label: 'function', body: 'fn ${1:name}(${2:args}) -> ${3:()} {\n    ${0}\n}' },
    { prefix: 'struct', label: 'struct', body: 'struct ${1:Name} {\n    ${2:field}: ${3:u32},\n}' },
    { prefix: 'impl', label: 'impl block', body: 'impl ${1:Type} {\n    fn ${2:name}(&self) {\n        ${0}\n    }\n}' },
    { prefix: 'match', label: 'match expression', body: 'match ${1:value} {\n    ${2:pattern} => ${0},\n    _ => ${3},\n}' },
    { prefix: 'test', label: 'test function', body: '#[test]\nfn ${1:name}() {\n    assert_eq!(${2:1 + 1}, ${0:2});\n}' },
  ],
  php: [
    { prefix: 'main', label: 'PHP file header', body: '<?php\n\n\\$${1:name} = trim(fgets(STDIN));\necho "Hello, " . (\\$${1:name} ?: "World") . PHP_EOL;\n${0}' },
    { prefix: 'function', label: 'function', body: 'function ${1:name}(${2:\\$args}): ${3:string} {\n    ${0}\n}' },
    { prefix: 'class', label: 'class', body: 'class ${1:Name}\n{\n    public function __construct(private ${2:string} \\$${3:value})\n    {\n    }\n\n    ${0}\n}' },
    { prefix: 'foreach', label: 'foreach loop', body: 'foreach (\\$${1:items} as \\$${2:item}) {\n    ${0}\n}' },
    { prefix: 'if', label: 'if block', body: 'if (${1:condition}) {\n    ${0}\n}' },
  ],
  ruby: [
    { prefix: 'main', label: 'script header', body: '#!/usr/bin/env ruby\n# frozen_string_literal: true\n\n${0}' },
    { prefix: 'def', label: 'method', body: 'def ${1:name}(${2:args})\n  ${0}\nend' },
    { prefix: 'class', label: 'class', body: 'class ${1:Name}\n  def initialize(${2:args})\n    ${0}\n  end\nend' },
    { prefix: 'each', label: 'each loop', body: '${1:collection}.each do |${2:item}|\n  ${0}\nend' },
    { prefix: 'puts', label: 'puts', body: 'puts ${1:value}' },
  ],
  kotlin: [
    { prefix: 'main', label: 'main function', body: 'fun main() {\n    ${0:println("Hello, world!")}\n}' },
    { prefix: 'fun', label: 'function', body: 'fun ${1:name}(${2:args}): ${3:Int} {\n    ${0}\n}' },
    { prefix: 'class', label: 'class', body: 'class ${1:Name}(${2:val value: Int}) {\n    ${0}\n}' },
    { prefix: 'data', label: 'data class', body: 'data class ${1:Name}(val ${2:field}: ${3:String})' },
    { prefix: 'when', label: 'when expression', body: 'when (${1:value}) {\n    ${2:branch} -> ${0}\n    else -> Unit\n}' },
  ],
  perl: [
    { prefix: 'main', label: 'script header', body: '#!/usr/bin/env perl\nuse strict;\nuse warnings;\n\n${0}' },
    { prefix: 'sub', label: 'subroutine', body: 'sub ${1:name} {\n    my \\$${2:arg} = shift;\n    ${0}\n}' },
    { prefix: 'for', label: 'for loop', body: 'for my \\$${1:item} (@${2:list}) {\n    ${0}\n}' },
    { prefix: 'while', label: 'read STDIN', body: 'while (my \\$${1:line} = <STDIN>) {\n    chomp \\$${1:line};\n    ${0}\n}' },
  ],
  lua: [
    { prefix: 'main', label: 'script header', body: '#!/usr/bin/env lua\n\n${0}\n' },
    { prefix: 'function', label: 'function', body: 'local function ${1:name}(${2:args})\n    ${0}\nend' },
    { prefix: 'for', label: 'numeric for', body: 'for ${1:i} = ${2:1}, ${3:n} do\n    ${0}\nend' },
    { prefix: 'ipairs', label: 'ipairs loop', body: 'for ${1:i}, ${2:v} in ipairs(${3:t}) do\n    ${0}\nend' },
    { prefix: 'table', label: 'table literal', body: 'local ${1:name} = { ${2:key} = ${0:value} }' },
  ],
  scala: [
    { prefix: 'main', label: 'entry point', body: '@main def run(args: String*): Unit =\n  ${0:println("Hello, world!")}' },
    { prefix: 'def', label: 'method', body: 'def ${1:name}(${2:args}): ${3:Int} = {\n  ${0}\n}' },
    { prefix: 'caseclass', label: 'case class', body: 'case class ${1:Name}(${2:field}: ${3:String})' },
    { prefix: 'for', label: 'for comprehension', body: 'for (${1:item} <- ${2:seq}) yield ${0}' },
    { prefix: 'match', label: 'match expression', body: '${1:value} match {\n  case ${2:pattern} => ${0}\n}' },
  ],
  fsharp: [
    { prefix: 'main', label: 'entry point', body: 'module Program\n\n[<EntryPoint>]\nlet main argv =\n    ${0:printfn "Hello, world!"}\n    0' },
    { prefix: 'let', label: 'function', body: 'let ${1:name} (${2:args}) =\n    ${0}' },
    { prefix: 'type', label: 'record type', body: 'type ${1:Name} = { ${2:Field}: ${3:int} }' },
    { prefix: 'match', label: 'pattern match', body: 'match ${1:value} with\n| ${2:pattern} -> ${0}' },
    { prefix: 'pipe', label: 'pipeline', body: '${1:value}\n|> ${2:List.map} (${3:f})\n|> ${0}' },
  ],
  elixir: [
    { prefix: 'main', label: 'module', body: 'defmodule ${1:Name} do\n  def ${2:run} do\n    ${0}\n  end\nend' },
    { prefix: 'def', label: 'function', body: 'def ${1:name}(${2:args}) do\n  ${0}\nend' },
    { prefix: 'pipe', label: 'pipeline', body: '${1:enumerable}\n|> Enum.map(&${2:function}/1)\n|> ${0}' },
    { prefix: 'puts', label: 'IO.puts', body: 'IO.puts(${1:value})' },
  ],
  clojure: [
    { prefix: 'main', label: 'namespace + -main', body: '(ns ${1:core.core}\n  (:gen-class))\n\n(defn -main [& args]\n  ${0})' },
    { prefix: 'defn', label: 'function', body: '(defn ${1:name} [${2:args}]\n  ${0})' },
    { prefix: 'when', label: 'when', body: '(when ${1:condition}\n  ${0})' },
    { prefix: 'map', label: 'map', body: '(map #(${0}) ${1:coll})' },
  ],
  haskell: [
    { prefix: 'main', label: 'main', body: 'main :: IO ()\nmain = do\n  ${0:putStrLn "Hello, world!"}' },
    { prefix: 'function', label: 'function', body: '${1:name} :: ${2:Int -> Int}\n${1:name} ${3:x} =\n  ${0}' },
    { prefix: 'module', label: 'module header', body: 'module ${1:Main} where\n\n${0}' },
    { prefix: 'case', label: 'case expression', body: 'case ${1:value} of\n  ${2:pattern} -> ${0}' },
    { prefix: 'data', label: 'data type', body: 'data ${1:Name} = ${2:A} | ${3:B}\n  deriving (Show, Eq)' },
  ],
  sql: [
    { prefix: 'table', label: 'create table', body: 'CREATE TABLE ${1:name} (\n  id INTEGER PRIMARY KEY,\n  ${2:name} TEXT NOT NULL\n);' },
    { prefix: 'select', label: 'select', body: 'SELECT ${1:*}\nFROM ${2:table}\nWHERE ${3:condition}\nORDER BY ${0:1};' },
    { prefix: 'join', label: 'join', body: 'SELECT ${1:*}\nFROM ${2:a} AS a\nJOIN ${3:b} AS b ON a.${4:id} = b.${4:id}\nWHERE ${0};' },
    { prefix: 'insert', label: 'insert', body: 'INSERT INTO ${1:table} (${2:columns})\nVALUES (${0});' },
    { prefix: 'index', label: 'create index', body: 'CREATE INDEX ${1:name}_idx ON ${1:name} (${0:column});' },
  ],
  shell: [
    { prefix: 'main', label: 'script header', body: '#!/usr/bin/env bash\nset -euo pipefail\n\n${0}\n' },
    { prefix: 'if', label: 'if block', body: 'if [[ ${1:condition} ]]; then\n  ${0}\nfi' },
    { prefix: 'for', label: 'for loop', body: 'for ${1:item} in ${2:list}; do\n  ${0}\ndone' },
    { prefix: 'while', label: 'read lines', body: 'while IFS= read -r ${1:line}; do\n  ${0}\ndone' },
    { prefix: 'function', label: 'function', body: '${1:name}() {\n  local ${2:arg}="\\$@"\n  ${0}\n}' },
  ],
  powershell: [
    { prefix: 'main', label: 'script header', body: '#!/usr/bin/env pwsh\nparam([string] ${1:Name} = "World")\n\nWrite-Output "Hello, \\$${1:Name}"\n${0}' },
    { prefix: 'function', label: 'function', body: 'function Get-${1:Name} {\n  param([${2:string}] \\$${3:Value})\n  ${0}\n}' },
    { prefix: 'foreach', label: 'foreach loop', body: 'foreach (\\$${1:item} in \\$${2:collection}) {\n  ${0}\n}' },
    { prefix: 'if', label: 'if block', body: 'if (${1:condition}) {\n  ${0}\n}' },
  ],
  bat: [
    { prefix: 'main', label: 'script header', body: '@echo off\nsetlocal\n\n${0}\n\nendlocal' },
    { prefix: 'set', label: 'variable', body: 'set "${1:NAME}=${0:value}"' },
    { prefix: 'if', label: 'if block', body: 'if ${1:exist} ${2:"%FILE%"} (\n  ${0}\n)' },
    { prefix: 'for', label: 'for loop', body: 'for %%${1:X} in (${2:"*.txt"}) do (\n  ${0}\n)' },
  ],
};

/**
 * Idempotent per Monaco instance: registers a real completion provider per
 * language once a bundled instance exists (called from the editor mount path
 * in IdeShell). Returns a disposer that re-enables registration. Tracked in a
 * module WeakSet because the bundled `monaco` namespace object is sealed in
 * production builds — writing a marker property onto it throws.
 */
const snippetGuard = new WeakSet();

export function registerSnippetProviders(monaco) {
  if (!monaco?.languages || typeof monaco.languages.registerCompletionItemProvider !== 'function') return () => {};
  if (snippetGuard.has(monaco)) return () => {};
  snippetGuard.add(monaco);
  const disposables = [];
  for (const [languageId, snippets] of Object.entries(SNIPPETS)) {
    disposables.push(
      monaco.languages.registerCompletionItemProvider(languageId, {
        provideCompletionItems(model, position) {
          // Snippets can be turned off entirely in Customize IDE.
          if (readPrefs().snippets === false) return { suggestions: [] };
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };
          return {
            suggestions: snippets.map((s, i) => ({
              label: { label: s.prefix, description: s.label },
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: s.body,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              detail: 'snippet',
              range,
              sortText: String(i).padStart(3, '0'),
            })),
          };
        },
      }),
    );
  }
  return () => {
    snippetGuard.delete(monaco);
    disposables.forEach((d) => {
      try {
        d.dispose();
      } catch {
        /* ignore */
      }
    });
  };
}

export { SNIPPETS };
