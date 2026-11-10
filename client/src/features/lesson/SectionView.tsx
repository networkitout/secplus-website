import { useId, type ComponentType, type Ref } from 'react';
import type { DiagramName } from '../../../../shared/diagrams';
import type { LessonView, LessonViewBlock } from '../../../../shared/types';
import type { Rewards } from '../../api/types';
import { DIAGRAMS } from '../diagrams/registry';
import { InlineCheck, type CheckResult } from './InlineCheck';

type Section = LessonView['sections'][number];

// Typography for the sanitised lesson HTML, which arrives as plain tags without classes.
const PROSE = [
  // Wide tables scroll sideways; the padding keeps focus outlines at the edges from being clipped.
  '-m-1 space-y-4 overflow-x-auto p-1 leading-relaxed',
  '[&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_h4]:font-semibold',
  '[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2',
  '[&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6',
  '[&_code]:rounded [&_code]:bg-surface [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm',
  '[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-surface [&_pre]:p-3 [&_pre_code]:p-0',
  '[&_table]:w-full [&_table]:border-collapse [&_table]:text-sm',
  '[&_th]:border [&_th]:border-border [&_th]:bg-surface [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold',
  '[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top',
  '[&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted',
  '[&_aside]:space-y-2 [&_aside]:rounded-md [&_aside]:border [&_aside]:border-l-4 [&_aside]:border-border [&_aside]:bg-surface [&_aside]:p-4',
  '[&_aside.tip]:border-l-accent [&_aside.trap]:border-l-warn',
  '[&_img]:h-auto [&_img]:max-w-full [&_hr]:border-border',
].join(' ');

/** The component for a diagram name, if this build of the client has one. */
function diagramFor(name: string): ComponentType | undefined {
  return Object.hasOwn(DIAGRAMS, name) ? DIAGRAMS[name as DiagramName] : undefined;
}

function Block({
  block,
  results,
  onAnswered,
}: {
  block: LessonViewBlock;
  results: Record<string, CheckResult>;
  onAnswered(questionId: string, answered: CheckResult & Rewards): void;
}) {
  switch (block.kind) {
    case 'html':
      // The one place the client inserts HTML: the server's lesson parser has already sanitised it.
      return (
        <div>
          <div className={PROSE} dangerouslySetInnerHTML={{ __html: block.html }} />
        </div>
      );
    case 'diagram': {
      const Diagram = diagramFor(block.name);
      return Diagram ? (
        <Diagram />
      ) : (
        <p role="note" className="rounded-md border border-border p-3 text-sm text-muted">
          Diagram unavailable
        </p>
      );
    }
    case 'check': {
      const { question } = block;
      return <InlineCheck question={question} result={results[question.id]} onAnswered={(a) => onAnswered(question.id, a)} />;
    }
    default:
      return null;
  }
}

/** One lesson section: its heading and its blocks in order. */
export function SectionView({
  section,
  headingRef,
  results,
  onAnswered,
}: {
  section: Section;
  headingRef?: Ref<HTMLHeadingElement>;
  /** Marked checks by question id. */
  results: Record<string, CheckResult>;
  onAnswered(questionId: string, answered: CheckResult & Rewards): void;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-5">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-xl font-semibold">
        {section.title}
      </h2>
      {section.blocks.map((block, i) => (
        <Block key={i} block={block} results={results} onAnswered={onAnswered} />
      ))}
    </section>
  );
}
