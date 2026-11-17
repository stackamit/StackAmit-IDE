import { describe, expect, it } from 'vitest';
import { diffLines, highlightCode, isSensitivePath, loadConversations, maskSecret, markdownLines, parseMarkdown, searchConversations } from '../aiChat.js';

describe('AI chat utilities', () => {
  it('parses markdown code fences and headings', () => {
    const blocks = parseMarkdown('# Title\n\n```python\nprint(1)\n```');
    expect(blocks).toEqual([{ type: 'markdown', text: '# Title\n\n' }, { type: 'code', language: 'python', code: 'print(1)' }]);
    expect(markdownLines('# Title')[0]).toMatchObject({ kind: 'heading', level: 1 });
    expect(highlightCode('const answer = 42;').some((part) => part.kind === 'keyword')).toBe(true);
  });

  it('migrates legacy chat history without losing messages', () => {
    const storage = { getItem: (key) => key === 'stackamit:ai-chat' ? JSON.stringify([{ role: 'user', text: 'Hello' }]) : null };
    const conversations = loadConversations(storage);
    expect(conversations).toHaveLength(1);
    expect(conversations[0].messages[0].text).toBe('Hello');
  });

  it('searches conversation titles and message text', () => {
    const conversations = [{ id: '1', title: 'Python help', messages: [] }, { id: '2', title: 'Other', messages: [{ text: 'Explain React' }] }];
    expect(searchConversations(conversations, 'react')).toHaveLength(1);
    expect(searchConversations(conversations, 'python')).toHaveLength(1);
  });

  it('protects sensitive paths and masks secrets', () => {
    expect(isSensitivePath('/project/.env')).toBe(true);
    expect(isSensitivePath('/project/src/main.js')).toBe(false);
    expect(maskSecret('sk-test-123456789')).toBe('sk-t••••••••6789');
  });

  it('creates review rows for additions and removals', () => {
    expect(diffLines('one\ntwo', 'one\nthree')).toEqual([{ type: 'same', text: 'one', line: 1 }, { type: 'remove', text: 'two', line: 2 }, { type: 'add', text: 'three', line: 2 }]);
  });
});
