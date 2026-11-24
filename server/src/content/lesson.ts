import matter from 'gray-matter';
import { Marked, type Tokens } from 'marked';
import { DIAGRAM_NAMES } from '../../../shared/diagrams.js';
import type { Lesson, LessonBlock, LessonSection } from '../../../shared/types.js';
import { ContentError } from './loader.js';

export type { Lesson, LessonBlock, LessonSection } from '../../../shared/types.js';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const SAFE_HREF = /^(https?:|mailto:|[/#.]|[^:]*$)/i;

// One shared instance: raw HTML is escaped, unsafe URLs are dropped, callouts become <aside>.
const marked = new Marked({
  renderer: {
    html: ({ text }: Tokens.HTML | Tokens.Tag) => escapeHtml(text),
    link({ href, title, tokens }: Tokens.Link) {
      const text = this.parser.parseInline(tokens);
      if (!SAFE_HREF.test(href.trim())) return text;
      return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ''}>${text}</a>`;
    },
    image({ href, title, text }: Tokens.Image) {
      if (!SAFE_HREF.test(href.trim())) return escapeHtml(text);
      return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ''}>`;
    },
    blockquote({ tokens }: Tokens.Blockquote) {
      const body = this.parser.parse(tokens);
      const first = tokens[0];
      const lead = first?.type === 'paragraph' ? (first as Tokens.Paragraph).tokens[0] : undefined;
      const label = lead?.type === 'strong' ? (lead as Tokens.Strong).text : '';
      const kind = label === 'Exam tip:' ? 'tip' : label === 'Common trap:' ? 'trap' : null;
      return kind ? `<aside class="callout ${kind}">\n${body}</aside>\n` : `<blockquote>\n${body}</blockquote>\n`;
    },
  },
});

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const DIRECTIVE = /^:::(diagram|check)\s+(\S+)\s*$/;
const HEADING = /^## +(.+?)\s*#*\s*$/;

export function parseLesson(source: string, file: string): Lesson {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(source);
  } catch (e) {
    throw new ContentError(file, 'frontMatter', `invalid front matter: ${(e as Error).message}`);
  }
  const { objective, title, minutes } = parsed.data as Record<string, unknown>;
  if (typeof objective !== 'string' || !objective) throw new ContentError(file, 'objective', 'front matter needs a string "objective"');
  if (typeof title !== 'string' || !title.trim()) throw new ContentError(file, 'title', 'front matter needs a "title"');
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes <= 0)
    throw new ContentError(file, 'minutes', 'front matter needs a positive integer "minutes"');

  const sections: LessonSection[] = [];
  let buffer: string[] = [];
  let fence: { char: string; len: number } | null = null;

  const flush = () => {
    const text = buffer.join('\n');
    buffer = [];
    if (!text.trim()) return;
    if (!sections.length) throw new ContentError(file, 'sections', 'content before the first "## " heading');
    sections.at(-1)!.blocks.push({ kind: 'html', html: marked.parse(text, { async: false }) });
  };

  for (const line of parsed.content.split(/\r?\n/)) {
    const f = FENCE.exec(line);
    if (fence) {
      buffer.push(line);
      if (f && f[1]![0] === fence.char && f[1]!.length >= fence.len && line.trim() === f[1]) fence = null;
      continue;
    }
    if (f) {
      fence = { char: f[1]![0]!, len: f[1]!.length };
      buffer.push(line);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      sections.push({ id: `s${sections.length + 1}`, title: heading[1]!, blocks: [] });
      continue;
    }
    const directive = DIRECTIVE.exec(line);
    if (directive) {
      flush();
      if (!sections.length) throw new ContentError(file, 'sections', 'directive before the first "## " heading');
      const arg = directive[2]!;
      let block: LessonBlock;
      if (directive[1] === 'diagram') {
        if (!(DIAGRAM_NAMES as readonly string[]).includes(arg)) throw new ContentError(file, 'diagram', `unknown diagram "${arg}"`);
        block = { kind: 'diagram', name: arg as (typeof DIAGRAM_NAMES)[number] };
      } else {
        block = { kind: 'check', questionId: arg };
      }
      sections.at(-1)!.blocks.push(block);
      continue;
    }
    buffer.push(line);
  }
  flush();

  if (!sections.length) throw new ContentError(file, 'sections', 'lesson has no "## " sections');
  return { objective, title: title.trim(), minutes, sections };
}
