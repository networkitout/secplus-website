import { expect, test } from 'vitest';
import { parseLesson } from './lesson.js';

const src = `---\nobjective: "1.1"\ntitle: Controls\nminutes: 12\n---\n## Categories\nText **bold**.\n\n:::diagram cia-triad\n\n> **Exam tip:** Watch the verb.\n\n## Types\n:::check q-1.1-001\n`;
const fm = '---\nobjective: "1.1"\ntitle: T\nminutes: 5\n---\n';
const htmlOf = (md: string) =>
  parseLesson(fm + '## A\n' + md, 'x.md').sections[0]!.blocks.map((b) => (b.kind === 'html' ? b.html : '')).join('');

test('parses front matter and sections', () => {
  const l = parseLesson(src, 'x.md');
  expect(l).toMatchObject({ objective: '1.1', title: 'Controls', minutes: 12 });
  expect(l.sections.map((s) => [s.id, s.title])).toEqual([['s1', 'Categories'], ['s2', 'Types']]);
});

test('emits html, diagram, callout and check blocks in order', () => {
  const [s1, s2] = parseLesson(src, 'x.md').sections;
  expect(s1!.blocks.map((b) => b.kind)).toEqual(['html', 'diagram', 'html']);
  expect((s1!.blocks[0] as any).html).toContain('<strong>bold</strong>');
  expect((s1!.blocks[1] as any).name).toBe('cia-triad');
  expect((s1!.blocks[2] as any).html).toContain('class="callout tip"');
  expect(s2!.blocks).toEqual([{ kind: 'check', questionId: 'q-1.1-001' }]);
});

test('renders a common trap callout', () => {
  expect(htmlOf('> **Common trap:** Careful.\n')).toContain('<aside class="callout trap">');
});

test('rejects missing front matter field', () =>
  expect(() => parseLesson('## A\ntext', 'x.md')).toThrow(expect.objectContaining({ field: 'objective' })));

test.each([
  ['title', '---\nobjective: "1.1"\nminutes: 5\n---\n## A\nx'],
  ['minutes', '---\nobjective: "1.1"\ntitle: T\nminutes: soon\n---\n## A\nx'],
])('rejects bad %s', (field, text) =>
  expect(() => parseLesson(text, 'x.md')).toThrow(expect.objectContaining({ name: 'ContentError', field })));

test('rejects a lesson with no sections', () =>
  expect(() => parseLesson(fm + 'text', 'x.md')).toThrow(expect.objectContaining({ field: 'sections' })));

test('rejects an unknown diagram name', () =>
  expect(() => parseLesson(fm + '## A\n:::diagram nope\n', 'x.md')).toThrow(
    expect.objectContaining({ name: 'ContentError', field: 'diagram' }),
  ));

test('raw HTML in markdown is escaped', () => {
  expect(JSON.stringify(parseLesson(src.replace('Text', '<script>x</script>'), 'x.md'))).not.toContain('<script>');
  const out = htmlOf('<img src=x onerror=alert(1)> and\n\n<div onclick="x">hi</div>\n');
  expect(out).not.toMatch(/<img|<div/);
  expect(out).toContain('&lt;img');
});

test('javascript: links are not rendered as links', () => {
  expect(htmlOf('[x](javascript:alert(1)) [ok](https://example.com)')).not.toContain('javascript:');
  expect(htmlOf('[ok](https://example.com)')).toContain('href="https://example.com"');
});

test('directives inside fenced code are plain code', () => {
  const l = parseLesson(fm + '## A\n```\n:::diagram nope\n## not a heading\n```\n', 'x.md');
  expect(l.sections).toHaveLength(1);
  expect(l.sections[0]!.blocks.map((b) => b.kind)).toEqual(['html']);
  expect((l.sections[0]!.blocks[0] as any).html).toContain(':::diagram nope');
});
