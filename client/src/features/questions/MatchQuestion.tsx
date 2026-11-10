import {
  DndContext,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { useId } from 'react';
import type { Answer, Feedback, Item, PublicQuestion } from '../../../../shared/types';
import { Mark } from './FeedbackPanel';

export function MatchQuestion({
  question,
  value,
  onChange,
  feedback,
  locked,
  labelledBy,
}: {
  question: Extract<PublicQuestion, { type: 'match' }>;
  value: Extract<Answer, { type: 'match' }> | null;
  onChange(a: Answer): void;
  feedback?: Feedback;
  locked: boolean;
  labelledBy: string;
}) {
  const pairs = value?.pairs ?? {};
  const correctPairs = feedback?.correctAnswer.type === 'match' ? feedback.correctAnswer.pairs : null;
  const used = new Set(Object.values(pairs));

  // Mouse and touch only: the menus are the keyboard route. A touch drag starts after a short press so
  // that swiping over an answer still scrolls the page.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const leftText = (id: UniqueIdentifier) => question.left.find((i) => i.id === id)?.text ?? String(id);
  const rightText = (id: UniqueIdentifier) => question.right.find((i) => i.id === id)?.text ?? String(id);

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${rightText(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${rightText(active.id)} is over ${leftText(over.id)}.` : undefined),
    onDragEnd: ({ active, over }) =>
      over
        ? `${rightText(active.id)} matched to ${leftText(over.id)}.`
        : `${rightText(active.id)} dropped. Nothing changed.`,
    onDragCancel: ({ active }) => `Matching ${rightText(active.id)} cancelled.`,
  };

  /** Pair `leftId` with `rightId` (empty to clear it). A right item is used once, so it leaves any other pair. */
  function pair(leftId: string, rightId: string) {
    const next: Record<string, string> = {};
    for (const left of question.left) {
      const right = left.id === leftId ? rightId : pairs[left.id];
      if (right && (left.id === leftId || right !== rightId)) next[left.id] = right;
    }
    onChange({ type: 'match', pairs: next });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (over) pair(String(over.id), String(active.id));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragEnd={onDragEnd}
      accessibility={{ announcements }}
    >
      <div role="group" aria-labelledby={labelledBy} className="space-y-4">
        <ul role="list" className="space-y-2">
          {question.left.map((left) => (
            <LeftRow
              key={left.id}
              left={left}
              right={question.right}
              chosen={pairs[left.id] ?? ''}
              locked={locked}
              expected={correctPairs ? (correctPairs[left.id] ?? '') : null}
              onChoose={(rightId) => pair(left.id, rightId)}
            />
          ))}
        </ul>
        {!feedback && (
          <div className="space-y-2">
            <p className="text-sm text-muted">Pick a match from each menu, or drag an answer onto its item.</p>
            <ul role="list" className="flex flex-wrap gap-2">
              {question.right.map((right) => (
                <AnswerChip key={right.id} item={right} used={used.has(right.id)} locked={locked} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </DndContext>
  );
}

function LeftRow({
  left,
  right,
  chosen,
  locked,
  expected,
  onChoose,
}: {
  left: Item;
  right: Item[];
  chosen: string;
  locked: boolean;
  /** The correct right item's id once the answer has been marked ('' if the item has no match). */
  expected: string | null;
  onChoose(rightId: string): void;
}) {
  const id = useId();
  const { setNodeRef, isOver } = useDroppable({ id: left.id, disabled: locked });
  const marked = expected !== null;
  const ok = chosen === expected;
  const expectedText = right.find((r) => r.id === expected)?.text;
  const border = marked
    ? ok ? 'border-ok' : 'border-bad'
    : isOver ? 'border-dashed border-accent' : 'border-border';

  return (
    <li ref={setNodeRef} className={`rounded-md border bg-surface p-3 ${border}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label htmlFor={`${id}-select`} className="min-w-0 flex-1 basis-40">
          {left.text}
        </label>
        <select
          id={`${id}-select`}
          aria-label={`Match for ${left.text}`}
          aria-describedby={marked ? `${id}-mark` : undefined}
          className="min-w-0 flex-1 basis-40 rounded-md border border-border bg-bg px-3 py-2 text-text disabled:cursor-not-allowed"
          value={chosen}
          disabled={locked}
          onChange={(e) => onChoose(e.target.value)}
        >
          <option value="">Choose…</option>
          {right.map((r) => (
            <option key={r.id} value={r.id}>
              {r.text}
            </option>
          ))}
        </select>
      </div>
      {marked && (
        <div id={`${id}-mark`} className="mt-2">
          <Mark ok={ok}>
            {ok ? 'Correct' : expectedText ? `Incorrect. Correct match: ${expectedText}` : 'Incorrect'}
          </Mark>
        </div>
      )}
    </li>
  );
}

function AnswerChip({ item, used, locked }: { item: Item; used: boolean; locked: boolean }) {
  const { setNodeRef, listeners, transform, isDragging } = useDraggable({ id: item.id, disabled: locked });
  return (
    <li className={isDragging ? 'relative z-10' : undefined}>
      <span
        ref={setNodeRef}
        {...listeners}
        style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }}
        className={`inline-flex touch-manipulation select-none items-center gap-2 rounded-md border bg-surface px-3 py-2 text-sm [-webkit-touch-callout:none] ${
          isDragging ? 'border-accent shadow-lg' : 'border-border'
        } ${locked ? '' : 'cursor-grab'}`}
      >
        {item.text}
        {used && <span className="text-xs text-muted">in use</span>}
      </span>
    </li>
  );
}
