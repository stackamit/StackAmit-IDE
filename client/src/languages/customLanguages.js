/**
 * Custom Monaco languages for formats the bundled `basic-languages` set does
 * not ship (verified against monaco-editor 0.52 in node_modules).
 *
 * Each entry registers a real Monarch tokenizer + language configuration
 * (comments, brackets, auto-close pairs, indentation rules). These provide
 * genuine syntax highlighting — nothing more is claimed. Languages that do
 * have a bundled grammar (Kotlin, Swift, R, Julia, Perl, Lua, Scala, F#, VB,
 * Elixir, Clojure, Solidity, GraphQL, HCL, Protobuf, Dockerfile, INI …) are
 * never re-registered here; they get highlighting from Monaco itself and
 * capability metadata from `languageCapabilities.js`.
 *
 * Registration is idempotent per Monaco instance and fully guarded: if the
 * Monaco API ever shifts, existing languages keep working untouched.
 */

// Monarch expects keyword lists as arrays of single tokens.
const keywordsOf = (...words) => words.join(' ').split(/\s+/).filter(Boolean);

// Shared number pattern. Monarch resolves `@number` against the language
// definition object, so registerCustomLanguages() merges this onto every spec.
const NUMBER = /(?:0[xXoObB][0-9a-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][-+]?\d+)?(?:[eE][-+]?\d+)?)|\d[\d_]*\.[\d_]+/;

/** Build a C-like tokenizer from a keyword list (groovy shares it). */
function cLike(keywords, extraRules = []) {
  return {
    keywords,
    tokenizer: {
      root: [
        [/[a-zA-Z_][\w$]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        { include: '@whitespace' },
        ...extraRules,
        [/[{}()[];,.]/, '@brackets'],
        [/@number/, 'number'],
      ],
      whitespace: [
        [/[ \t\r\n]+/, ''],
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
      ],
      comment: [[/[^/*]+/, 'comment'], [/\*\//, 'comment', '@pop'], [/[/*]/, 'comment']],
    },
  };
}

/* ------------------------------------------------------------------ */
/* Individual language definitions                                     */
/* ------------------------------------------------------------------ */

const groovy = {
  monarch: cLike(
    keywordsOf(
      'abstract as assert boolean break byte case catch char class const continue def default do else extends final finally for goto if implements import in instanceof int interface long new package return short static super switch synchronized this throw throws trait try void while',
    ),
    [[/'(?:\\.|[^'\\])*'/, 'string.quote'], [/"""[\s\S]*?"""/, 'string'], [/"[\s\S]*?"/, 'string']],
  ),
  config: {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' },
      { open: '"', close: '"' }, { open: "'", close: "'" },
    ],
  },
};

const matlab = {
  monarch: {
    keywords: keywordsOf('break case catch continue else elseif end for function global if parfor return switch try while'),
    builtin: keywordsOf('disp fprintf sprintf input length max mean min size zeros ones plot'),
    tokenizer: {
      root: [
        [/%!--.*$/, 'comment'], // Cell markers double as comments.
        [/%\{/, 'comment', '@blockcomment'],
        [/%.*$/, 'comment'],
        [/[a-zA-Z_]\w*/, { cases: { '@keywords': 'keyword', '@builtin': 'predefined', '@default': 'identifier' } }],
        [/'(?:[^'\n]|'')*'/, 'string'],
        [/"(?:[^"\n]|"")*"/, 'string'],
        [/@number/, 'number'],
        [/[.][*]|[.]/, 'delimiter'],
        // `;` and `,` are delimiters, not bracket pairs — Monaco throws
        // "@brackets token returned but no bracket defined" if they ride @brackets.
        [/[{}()\[\]]/, '@brackets'],
        [/[;,]/, 'delimiter'],
      ],
      blockcomment: [[/[^%]+/, 'comment'], [/%\}/, 'comment', '@pop'], [/%/, 'comment']],
    },
  },
  config: {
    comments: { lineComment: '%', blockComment: ['%{', '%}'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' },
      { open: '"', close: '"' }, { open: "'", close: "'" },
    ],
  },
};

const erlang = {
  monarch: {
    keywords: keywordsOf('after and band begin bnot bor bsl bsr bxor case catch cond div end fun if let not of or orelse query receive rem try when xor'),
    operators: keywordsOf('andalso orelse'),
    tokenizer: {
      root: [
        [/[a-z][a-zA-Z0-9_]*@?/, { cases: { '@keywords': 'keyword', '@default': 'type' } }], // atoms
        [/[A-Z_][a-zA-Z0-9_]*/, 'variable'],
        [/\?[\w]+/, 'meta'],
        [/-[\w]+(?=\s*\(|:)/, 'keyword'], // -module, -export …
        { include: '@whitespace' },
        [/"(?:\\.|[^"\\])*"/, 'string'], // Erlang strings are double-quoted
        [/'(?:\\.|[^'\\])*'/, 'string'],
        [/@number/, 'number'],
        [/[(){}\[\]]/, '@brackets'],
        [/[;,]/, 'delimiter'],
        [/[-+*/<>=!~:]+/, 'operator'],
      ],
      whitespace: [[/\s+/, ''], [/%.*$/, 'comment']],
    },
  },
  config: {
    comments: { lineComment: '%' },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' },
      { open: '"', close: '"' }, { open: "'", close: "'" },
    ],
  },
};

const haskell = {
  monarch: {
    keywords: keywordsOf('case of let in where do if then else module import class instance data newtype type deriving infix default'),
    builtin: keywordsOf('Maybe Just Nothing Either Left Right IO String Char Int Integer Float Bool True False'),
    tokenizer: {
      root: [
        [/--.*$/, 'comment'],
        [/\{-/, 'comment', '@blockcomment'],
        [/[a-z][\w']*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        [/[A-Z][\w']*/, { cases: { '@builtin': 'predefined', '@default': 'typeIdentifier' } }],
        [/'(?:\\.|[^'\\])'/, 'character'],
        [/"(?:\\.|[^"\\])*"/, 'string'],
        [/@number/, 'number'],
        [/[(){}\[\]]/, '@brackets'],
        [/[;,]/, 'delimiter'],
        [/->|[=:<]|[+\-\*\/%!<>&|\^~@#$?.]+/, 'operator'],
      ],
      blockcomment: [[/\{-/, 'comment', '@push'], [/-\}/, 'comment', '@pop'], [/[^{-]+/, 'comment'], [/[{-]/, 'comment']],
    },
  },
  config: {
    comments: { lineComment: '--', blockComment: ['{-', '-}'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' },
      { open: '"', close: '"' }, { open: "'", close: "'" },
    ],
  },
};

const ocaml = {
  monarch: {
    keywords: keywordsOf('and as assert asr begin class constraint do done downto else end exception external false for fun function functor if in include inherit initializer land lazy let lor lsl lsr lxor match method mod module mutable new nonrec of open or rec then true try type val virtual when while with'),
    builtin: keywordsOf('string int float char bool unit list array option Some None true false ref'),
    tokenizer: {
      root: [
        [/\(\*/, 'comment', '@comment'],
        [/[a-z_][\w']*/, { cases: { '@keywords': 'keyword', '@builtin': 'predefined', '@default': 'identifier' } }],
        [/[A-Z][\w']*/, 'typeIdentifier'],
        [/'[a-z_][\w']*/, 'type'], // polymorphic type vars
        { include: '@strings' },
        [/@number/, 'number'],
        [/[(){}\[\]]/, '@brackets'],
        [/[;,]/, 'delimiter'],
        [/[=\.<>|&+\-\*\/@^:]+/, 'operator'],
      ],
      strings: [
        [/"(?:\\.|[^"\\])*"/, 'string'],
        [/\{[a-zA-Z_]*\|/, 'string', '@nestedString'],
      ],
      nestedString: [[/[^|}]+/, 'string'], [/\|\}/, 'string', '@pop'], [/[|}]/, 'string']],
      comment: [[/\(\*/, 'comment', '@push'], [/\*\)/, 'comment', '@pop'], [/[^(*\)]+/, 'comment'], [/[(*)\]]/, 'comment']],
    },
  },
  config: {
    comments: { blockComment: ['(*', '*)'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' },
      { open: '"', close: '"' },
    ],
  },
};

const fortran = {
  monarch: {
    ignoreCase: true,
    keywords: keywordsOf('action allocate assign backspace block call character close common complex continue cycle data deallocate default dimension do else elseif else if end endif entry equivalence external file format function goto if implicit in inquire integer interface logical namelist open parameter pause print program read real record return stop subroutine then type use where write while'),
    tokenizer: {
      root: [
        [/[!].*$/, 'comment'],
        [/^[cC].*$/, 'comment'],
        [/[a-zA-Z]\w*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        [/'(?:[^'\n])*'/, 'string'],
        [/"(?:[^"\n])*"/, 'string'],
        [/@number/, 'number'],
        [/[(){}\[\]]/, '@brackets'],
        [/[;,]/, 'delimiter'],
        [/(\.)(?:eq|ne|lt|le|gt|ge|and|or|not|eqv|neqv)(\.)/, 'keyword'],
      ],
    },
  },
  config: {
    comments: { lineComment: '!' },
    brackets: [['(', ')'], ['[', ']'], ['{', '}']],
    autoClosingPairs: [
      { open: '(', close: ')' }, { open: '[', close: ']' }, { open: "'", close: "'" }, { open: '"', close: '"' },
    ],
  },
};

const cobol = {
  monarch: {
    ignoreCase: true,
    keywords: keywordsOf('identification division environment data procedure author date writing security file control section working-storage local-storage linkage reporting screen program-id select organization is assign record access key upon can using picture giving display accept move to from subtract multiply divide compute if then else end-if perform until varying times with equal when other exit cycle stop run initial end-add end-subtract end-multiply end-divide end-perform end-evaluate call return'),
    tokenizer: {
      root: [
        [/^\s*\*.*$/, 'comment'],
        [/"[^"]*"/, 'string'],
        [/'[^']*'/, 'string'],
        [/\b[a-z][\w-]*\b/i, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        [/\d+/, 'number'],
        [/[.,:()]/, 'delimiter'],
      ],
    },
  },
  config: {
    comments: { lineComment: '*' },
    brackets: [['(', ')']],
    autoClosingPairs: [{ open: '(', close: ')' }, { open: '"', close: '"' }, { open: "'", close: "'" }],
  },
};

const asm = {
  monarch: {
    ignoreCase: true,
    keywords: keywordsOf('mov lea add sub mul imul div idiv inc dec neg not and or xor shl shr sar cmp test jmp jz jnz jl jle jg jge jc jnc loop lloop push pop call ret int syscall enter leave cdq cqo movzx movsx setz sete setne xor'),
    directives: keywordsOf('section global extern db dw dd dq resb resq align equ times byte word dword qword proc endproc'),
    registers: keywordsOf('rax rbx rcx rdx rsi rdi rbp rsp r8 r9 r10 r11 r12 r13 r14 r15 eax ebx ecx edx esi edi ebp esp ax bx cx dx al bl cl dl sil dil r8d r9d ip eip rip st0 st1 mm0 xmm0 ymm0 zmm0 cs ds ss es fs gs k0 k1'),
    tokenizer: {
      root: [
        [/;.*/, 'comment'],
        [/^\s*[\w.]+:/, 'identifier.predefined'], // labels
        [/\$[a-zA-Z_][\w.]*/, 'identifier'],
        { include: '@strings' },
        [/@\w+|%[\w.]+/, 'variable'], // gas AT&T syntax
        [/[.\w][\w.]*/, { cases: { '@directives': 'keyword', '@registers': 'variable.name', '@keywords': 'keyword', '@default': 'identifier' } }],
        [/-?\d[\dxXa-fA-F_]*|0[xX][\da-fA-F]+/, 'number'],
        [/[()\[\],:+*-]/, 'delimiter'],
      ],
      strings: [[/"(?:\\.|[^"\\\n])*"/, 'string'], [/'(?:\\.|[^'\\\n])*'/, 'string']],
    },
  },
  config: {
    comments: { lineComment: ';' },
    brackets: [['[', ']'], ['(', ')'], ['{', '}']],
    autoClosingPairs: [
      { open: '[', close: ']' }, { open: '(', close: ')' }, { open: '{', close: '}' },
      { open: '"', close: '"' },
    ],
  },
};

/** Shared tokenizer factory for the HTML-template SFC family (vue/svelte/astro). */
function templateGrammar({ scriptKeywords, extra = [], states = {} }) {
  return {
    tokenizer: {
      root: [
        ...extra,
        // Whitespace must be consumed explicitly: without this rule the catch-all
        // below swallows ` id=` and the attribute name never gets a token.
        [/[ \t\r\n]+/, ''],
        [/<script/, 'delimiter', '@scriptTag'],
        [/<style/, 'delimiter', '@styleTag'],
        [/<!--/, 'comment', '@htmlComment'],
        [/<\/?[\w-]+/, { cases: { '@default': 'tag' } }],
        [/[a-zA-Z_][\w-]*(?==)/, 'attribute.name'],
        [/"[^"]*"|'[^']*'/, 'attribute.value'],
        [/{{[\s\S]*?}}/, 'expression'],
        [/>/, 'delimiter'],
        [/[^<>{}"']+/, ''],
      ],
      htmlComment: [[/[^-]+/, 'comment'], [/-->/, 'comment', '@pop'], [/-/, 'comment']],
      scriptTag: [[/>/, 'delimiter', '@scriptBody'], [/[^\s>]+/, 'attribute.name'], [/\s+/, '']],
      scriptBody: [
        [/<\/script/, 'delimiter', '@pop'],
        // Embedded JS tokens kept intentionally simple: strings, comments,
        // keywords — enough for readable highlighting inside SFC blocks.
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@blockComment'],
        [/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/, 'string'],
        [/\b(?:import|from|export|default|const|let|var|function|return|if|else|for|while|class|new|this|await|async|try|catch)\b/, 'keyword'],
        [/\d+(\.\d+)?/, 'number'],
        [/[{}()\[\];,.]/, 'delimiter'],
        [/[a-zA-Z_$][\w$]*/, ''],
      ],
      blockComment: [[/[^/*]+/, 'comment'], [/\*\//, 'comment', '@pop'], [/[/*]/, 'comment']],
      styleTag: [[/>/, 'delimiter', '@styleBody'], [/[^\s>]+/, 'attribute.name'], [/\s+/, '']],
      styleBody: [
        [/<\/style/, 'delimiter', '@pop'],
        [/\/\*[\s\S]*?\*\//, 'comment'],
        [/[a-zA-Z-]+(?=\s*:)/, 'attribute.name'],
        [/[^;{}<]+/, ''],
        [/[;{}]/, 'delimiter'],
      ],
      ...states,
    },
    keywords: scriptKeywords,
  };
}

const vue = {
  monarch: templateGrammar({ scriptKeywords: [] }),
  config: {
    comments: { blockComment: ['<!--', '-->'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' },
      { open: '<', close: '>' }, { open: '"', close: '"' },
    ],
  },
};

const svelte = {
  monarch: templateGrammar({
    scriptKeywords: [],
    extra: [
      [/\{#(?:if|each|await|key)[^}]*\}/, 'keyword'],
      [/\{:else[^}]*\}/, 'keyword'],
      [/\{@(?:html|const|debug)[^}]*\}/, 'keyword'],
      [/\$\:/, 'variable'],
    ],
  }),
  config: vue.config,
};

const astro = {
  monarch: templateGrammar({
    scriptKeywords: [],
    extra: [
      [/^---$/, 'delimiter', '@frontmatter'],
      [/\{(?=[^}]*\})/, 'expression'],
    ],
    // Astro's frontmatter block is JS between two `---` fence lines.
    states: {
      frontmatter: [
        [/^---$/, 'delimiter', '@pop'],
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@blockComment'],
        [/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/, 'string'],
        [/\b(?:import|from|export|default|const|let|var|function|return|if|else|for|while|class|new|this|await|async|try|catch)\b/, 'keyword'],
        [/\d+(\.\d+)?/, 'number'],
        [/[{}()\[\];,.]/, 'delimiter'],
        [/[a-zA-Z_$][\w$]*/, ''],
        [/[ \t\r\n]+/, ''],
      ],
    },
  }),
  config: vue.config,
};

const toml = {
  monarch: {
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        [/^\s*\[\[[\w.\-"']+\]\]/, 'type.identifier'],
        [/^\s*\[[\w.\-"']+\]/, 'type.identifier'],
        [/^\s*[\w.-]+(?=\s*=)/, 'attribute.name'],
        [/'(?:[^'\n])*'/, 'string'],
        [/"""[\s\S]*?"""/, 'string'],
        [/"(?:\\.|[^"\\\n])*"/, 'string'],
        [/\b(?:true|false)\b/, 'keyword'],
        [/\b(?:inf|nan)\b/, 'number'],
        [/@number/, 'number'],
        [/\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?/, 'string.date'],
        [/[=,{}\[\]]/, 'delimiter'],
      ],
    },
    keywords: [],
  },
  config: {
    comments: { lineComment: '#' },
    brackets: [['[', ']'], ['{', '}']],
    autoClosingPairs: [
      { open: '[', close: ']' }, { open: '{', close: '}' },
      { open: '"', close: '"' }, { open: "'", close: "'" },
    ],
  },
};

const nginx = {
  monarch: {
    directives: keywordsOf('server listen server_name root index location location_match return rewrite try_files proxy_pass proxy_set_header proxy_http_version proxy_redirect upstream fastcgi_pass fastcgi_param uwsgi_pass client_max_body_size keepalive_timeout gzip gzip_types ssl ssl_certificate ssl_certificate_key ssl_protocols add_header expires access_log error_log include if set map limit_req_zone limit_req worker_processes worker_connections use events http types default_type sendfile tcp_nopush tcp_nodelay charset log_format'),
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        { include: '@strings' },
        [/\$\w+/, 'variable'],
        // Numbers before the generic word rule, otherwise `listen 80` swallows 80.
        [/@number/, 'number'],
        [/\b[\w_]+(?=[\s;])/, { cases: { '@directives': 'keyword', '@default': '' } }],
        [/\b[\w_]+/, { cases: { '@directives': 'keyword', '@default': '' } }],
        [/[;{}]/, 'delimiter'],
        [/[^;$#{}\s"']+/, ''],
      ],
      strings: [[/'(?:[^'\\]|\\.)*'/, 'string'], [/"(?:[^"\\]|\\.)*"/, 'string']],
    },
    keywords: [],
  },
  config: {
    comments: { lineComment: '#' },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' },
      { open: '"', close: '"' }, { open: "'", close: "'" },
    ],
  },
};

const wat = {
  monarch: {
    keywords: keywordsOf('module func param result local global export import memory table type elem block loop br br_if if else call call_indirect return drop select store store8 store16 store32 load load8 load8_s load16 load16_s load32 load32_s grow current data offset i32 i64 f32 f64 start mut'),
    operators: keywordsOf('add sub mul div_s div_u rem_s rem_u and or xor shl shr_s shr_u rotl_rotr eq ne lt_s lt_u le_s gt_s ge_s'),
    tokenizer: {
      root: [
        [/;;.*$/, 'comment'],
        [/\$[\w.]+/, 'variable'],
        [/\((?:;.*\n)*?/, '@brackets'],
        [/'(?:\\.|[^'\\\n])*'/, 'string'],
        [/"(?:\\.|[^"\\\n])*"/, 'string'], // WAT text strings are double-quoted ("name")
        [/(?:0x[\da-fA-F]+|\d+)(?:_(?:0x[\da-fA-F]+|\d+))*/, 'number'],
        [/[a-z_][\w.]*-?[a-z_]?\w*/, { cases: { '@keywords': 'keyword', '@default': '' } }],
        [/[()]/, '@brackets'],
      ],
    },
    builtin: [],
  },
  config: {
    comments: { lineComment: ';;' },
    brackets: [['(', ')']],
    autoClosingPairs: [{ open: '(', close: ')' }, { open: '"', close: '"' }],
  },
};

const makefile = {
  monarch: {
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        [/^[\t ]+/, { cases: { '@default': '' } }], // recipe lines: tabs
        // Targets before variables: `build:` must not be eaten by the assignment rule.
        [/^[a-zA-Z_][\w.-]*(?=\s*:(?![=]))/, 'keyword.target'],
        [/^[a-zA-Z_][\w.-]*(?=\s*=)/, 'identifier'],
        [/\$(?:\([^)]*\)|\{[^}]*\}|[\w-]+)/, 'variable'], // $(VAR), ${VAR}, $x
        [/@number/, 'number'],
        [/[-\w\/.]+/, ''],
        [/[=:;'"\\]/, 'delimiter'],
      ],
    },
    keywords: keywordsOf('ifeq ifneq else endif include define endef export unset auto vars'),
  },
  config: {
    comments: { lineComment: '#' },
    brackets: [['(', ')'], ['{', '}']],
    autoClosingPairs: [
      { open: '(', close: ')' }, { open: '{', close: '}' },
      { open: '"', close: '"' }, { open: "'", close: "'" },
    ],
  },
};

const plsql = {
  monarch: {
    ignoreCase: true,
    keywords: keywordsOf('accept add all alter and any as asc audit begin between by char check cluster column comment commit compress connect create current date decimal delete desc distinct drop else exclusive exists fetch float for from grant group having identified immediate in increment index insert intersect into is like lock long maxextents minus mode modify noaudit not nowait null of on option order row rowid set share size table then to trigger uid union unique update using validate values varchar varchar2 where with access loop cursor open close fetch bulk collect forall exception when others raise sqldata notfound dup_val_on_index pragma serially_reusable autonomous_transaction package body function procedure return'),
    tokenizer: {
      root: [
        [/--.*$/, 'comment'],
        [/\|\|/, 'operator'],
        [/'(?:[^'\n]|'')*'/, 'string'],
        [/"[^"\n]*"/, 'type.identifier'],
        [/[a-z_][\w$#]*(?=\s*\()/, 'predefined'],
        [/\b\w+\b/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        [/@number/, 'number'],
        [/[(),;.%:=><+*/-]/, 'delimiter'],
      ],
    },
  },
  config: {
    comments: { lineComment: '--', blockComment: ['/*', '*/'] },
    brackets: [['(', ')'], ['[', ']'], ['{', '}']],
    autoClosingPairs: [
      { open: '(', close: ')' }, { open: '[', close: ']' }, { open: '{', close: '}' },
      { open: "'", close: "'" }, { open: '"', close: '"' },
    ],
    indentationRules: {
      increaseIndentPattern: /^\s*(BEGIN|IF|ELSIF|ELSE|CASE|WHEN|LOOP|FOR|EXCEPTION|DECLARE)\b/i,
      decreaseIndentPattern: /^\s*(END|ELSIF|ELSE|EXCEPTION)\b/i,
    },
  },
};

/* ------------------------------------------------------------------ */
/* Public registry + guarded registration                              */
/* ------------------------------------------------------------------ */

/** id -> { monarch, config, label } for every language Monaco does not bundle. */
export const CUSTOM_LANGUAGES = Object.freeze({
  matlab: { ...matlab, label: 'MATLAB' },
  groovy: { ...groovy, label: 'Groovy' },
  erlang: { ...erlang, label: 'Erlang' },
  haskell: { ...haskell, label: 'Haskell' },
  ocaml: { ...ocaml, label: 'OCaml' },
  fortran: { ...fortran, label: 'Fortran' },
  cobol: { ...cobol, label: 'COBOL' },
  asm: { ...asm, label: 'Assembly' },
  vue: { ...vue, label: 'Vue' },
  svelte: { ...svelte, label: 'Svelte' },
  astro: { ...astro, label: 'Astro' },
  toml: { ...toml, label: 'TOML' },
  nginx: { ...nginx, label: 'Nginx' },
  wat: { ...wat, label: 'WebAssembly Text' },
  makefile: { ...makefile, label: 'Makefile' },
  plsql: { ...plsql, label: 'PL/SQL' },
});

export const CUSTOM_LANGUAGE_IDS = Object.freeze(Object.keys(CUSTOM_LANGUAGES));

/**
 * Register all custom languages with the given Monaco instance. Idempotent per
 * instance (WeakSet guard, same pattern as snippets.js — the bundled monaco
 * namespace is sealed). Returns a disposer that allows re-registration.
 */
const registrationGuard = new WeakSet();

export function registerCustomLanguages(monaco) {
  if (!monaco?.languages?.register) return () => {};
  if (registrationGuard.has(monaco)) return () => {};
  registrationGuard.add(monaco);
  const disposables = [];
  const registeredIds = new Set(monaco.languages.getLanguages().map((l) => l.id));
  for (const [id, def] of Object.entries(CUSTOM_LANGUAGES)) {
    try {
      if (!registeredIds.has(id)) {
        monaco.languages.register({ id });
        disposables.push({ dispose: () => {} }); // ids can't be unregistered
      }
      // `@number` resolves against the definition object, not module scope.
      disposables.push(monaco.languages.setMonarchTokensProvider(id, { number: NUMBER, ...def.monarch }));
      if (def.config) disposables.push(monaco.languages.setLanguageConfiguration(id, def.config));
    } catch (err) {
      // Never let one bad grammar break the editor boot.
      console.warn(`Custom language "${id}" registration skipped:`, err);
    }
  }
  return () => {
    registrationGuard.delete(monaco);
    disposables.forEach((d) => {
      try { d.dispose(); } catch { /* ignore */ }
    });
  };
}
