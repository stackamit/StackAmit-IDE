const SENSITIVE_FILE = /(^|[\\/])(?:\.env(?:\.|$)|id_rsa(?:\.|$)|.*\.(?:pem|key|p12|pfx|crt|cer))$/i;

export function parseMarkdown(text = '') {
  const source = String(text ?? '');
  const blocks = [];
  const pattern = /```([^\n]*)\n([\s\S]*?)```/g;
  let cursor = 0;
  let match;
  while ((match = pattern.exec(source))) {
    if (match.index > cursor) blocks.push({ type: 'markdown', text: source.slice(cursor, match.index) });
    blocks.push({ type: 'code', language: match[1].trim() || 'text', code: match[2].replace(/\n$/, '') });
    cursor = pattern.lastIndex;
  }
  if (cursor < source.length) blocks.push({ type: 'markdown', text: source.slice(cursor) });
  return blocks.length ? blocks : [{ type: 'markdown', text: source }];
}

export function markdownLines(text = '') {
  return String(text).split('\n').map((line) => {
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const number = line.match(/^\s*\d+\.\s+(.*)$/);
    return heading ? { kind: 'heading', level: heading[1].length, text: heading[2] } : bullet ? { kind: 'bullet', text: bullet[1] } : number ? { kind: 'number', text: number[1] } : { kind: 'text', text: line };
  });
}

export function inlineMarkdown(text = '') {
  return String(text).split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) return { kind: 'code', text: part.slice(1, -1), key: index };
    if (part.startsWith('**') && part.endsWith('**')) return { kind: 'strong', text: part.slice(2, -2), key: index };
    if (part.startsWith('*') && part.endsWith('*')) return { kind: 'em', text: part.slice(1, -1), key: index };
    return { kind: 'text', text: part, key: index };
  });
}

export function highlightCode(code = '') {
  const token = /(\/\/.*|#.*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'])*'|"(?:\\.|[^"])*"|`(?:\\.|[^`])*`|\b(?:const|let|var|function|return|if|else|for|while|class|import|from|def|print|async|await|public|private|new|true|false|null|None|True|False)\b|\b\d+(?:\.\d+)?\b)/g;
  const parts = [];
  let cursor = 0;
  let match;
  while ((match = token.exec(String(code)))) {
    if (match.index > cursor) parts.push({ kind: 'plain', text: String(code).slice(cursor, match.index) });
    const value = match[0];
    const kind = /^(\/\/|#|\/\*)/.test(value) ? 'comment' : /^(['"`])/.test(value) ? 'string' : /^\d/.test(value) ? 'number' : 'keyword';
    parts.push({ kind, text: value });
    cursor = token.lastIndex;
  }
  if (cursor < String(code).length) parts.push({ kind: 'plain', text: String(code).slice(cursor) });
  return parts;
}

export function isSensitivePath(path = '') { return SENSITIVE_FILE.test(String(path)); }

export function clampContext(context, max = 12000) {
  if (!context) return null;
  return { ...context, content: String(context.content || '').slice(0, max), selectedCode: String(context.selectedCode || '').slice(0, max) };
}

export function maskSecret(value = '') {
  const secret = String(value || '');
  if (!secret) return '';
  if (secret.length <= 8) return '••••••••';
  return `${secret.slice(0, 4)}••••••••${secret.slice(-4)}`;
}

export function makeConversation(messages = [], title = 'New conversation') {
  return { id: `conversation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title, messages: Array.isArray(messages) ? messages : [], updatedAt: Date.now() };
}

export function loadConversations(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem('stackamit:ai-conversations') || 'null');
    if (Array.isArray(saved) && saved.length) return saved;
    const legacy = JSON.parse(storage?.getItem('stackamit:ai-chat') || '[]');
    return [makeConversation(legacy, legacy.find((m) => m.role === 'user')?.text?.slice(0, 48) || 'New conversation')];
  } catch { return [makeConversation()]; }
}

export function searchConversations(conversations, query = '') {
  const needle = String(query).trim().toLowerCase();
  if (!needle) return conversations;
  return conversations.filter((conversation) => conversation.title.toLowerCase().includes(needle) || conversation.messages.some((message) => String(message.text || '').toLowerCase().includes(needle)));
}

export function diffLines(before = '', after = '') {
  const oldLines = String(before).split('\n');
  const newLines = String(after).split('\n');
  const rows = [];
  const max = Math.max(oldLines.length, newLines.length);
  for (let index = 0; index < max; index += 1) {
    const oldLine = oldLines[index]; const newLine = newLines[index];
    if (oldLine === newLine) rows.push({ type: 'same', text: oldLine, line: index + 1 });
    else {
      if (oldLine !== undefined) rows.push({ type: 'remove', text: oldLine, line: index + 1 });
      if (newLine !== undefined) rows.push({ type: 'add', text: newLine, line: index + 1 });
    }
  }
  return rows;
}
