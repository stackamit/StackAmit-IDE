import test from 'node:test';
import assert from 'node:assert/strict';
import { contentPatchSchema, validate } from '../src/validators/code.validator.js';
import { DEFAULT_CONTENT, resolveContent } from '../src/config/siteContent.js';

test('site content defaults provide exactly three footer columns', () => {
  const content = resolveContent(null);
  assert.equal(content.footer.columns.length, 3);
  assert.equal(content.published, true);
  assert.equal(content.footer.columns[0].links.find((link) => link.id === 'download')?.href, '/download');
  assert.equal(content.navigation.links.find((link) => link.id === 'download')?.href, '/download');
});

test('site content rejects unsafe navigation URLs', () => {
  assert.throws(() => validate(contentPatchSchema, { navigation: { links: [{ id: 'x', label: 'Bad', href: 'javascript:alert(1)' }] } }));
  assert.doesNotThrow(() => validate(contentPatchSchema, { navigation: { links: [{ id: 'x', label: 'Safe', href: '/about' }, { id: 'y', label: 'External', href: 'https://example.com' }] } }));
  assert.throws(() => validate(contentPatchSchema, { social: { github: 'javascript:alert(1)' } }));
  assert.doesNotThrow(() => validate(contentPatchSchema, { social: { github: 'https://github.com/stackamit' } }));
});

test('unpublished stored content remains explicitly unpublished for the public service to gate', () => {
  const resolved = resolveContent({ published: false, home: { heroTitle: 'Private draft' } });
  assert.equal(resolved.published, false);
  assert.equal(resolved.home.heroTitle, 'Private draft');
});
