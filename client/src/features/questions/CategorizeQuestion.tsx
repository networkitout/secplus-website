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
  type Over,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { motion } from 'motion/react';
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import type { Answer, Feedback, Item, PublicQuestion } from '../../../../shared/types';
import { Mark } from './FeedbackPanel';

const UNPLACED = 'Not placed yet';

/** The bucket id a drop zone stands for; '' is the pool of unplaced items. */
const bucketOf = (over: Over) => String(over.data.current?.bucket ?? '');

export function CategorizeQuestion({
  question,
  value,
  onChange,
  feedback,
  locked,
  labelledBy,
}: {
  question: Extract<PublicQuestion, { type: 'categorize' }>;
  value: Extract<Answer, { type: 'categorize' }> | null;
  onChange(a: Answer): void;
  feedback?: Feedback;
  locked: boolean;
  labelledBy: string;
}) {
  const id = useId();
  const placements = value?.placements ?? {};
  const correct = feedback?.correctAnswer.type === 'categorize' ? feedback.correctAnswer.placements : null;
  const unplaced = question.items.filter((i) => !placements[i.id]);
  const layoutKey = question.items.map((i) => placements[i.id] ?? '').join(' ');

  const selects = useRef(new Map<string, HTMLSelectElement>());
  const focusAfterMove = useRef<string | null>(null);

  // Mouse and touch only: the menus are the keyboard route. A touch drag starts after a short press so
  // that swiping over an item still scrolls the page.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  // Choosing a bucket moves the item's card, menu included, to another list. Follow it with keyboard focus.
  useEffect(() => {
    const itemId = focusAfterMove.current;
    if (!itemId) return;
    focusAfterMove.current = null;
    selects.current.get(itemId)?.focus();
  });

  const itemText = (itemId: UniqueIdentifier) => question.items.find((i) => i.id === itemId)?.text ?? String(itemId);
  const bucketText = (bucketId: string) => question.buckets.find((b) => b.id === bucketId)?.text ?? UNPLACED;

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${itemText(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${itemText(active.id)} is over ${bucketText(bucketOf(over))}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `${itemText(active.id)} dropped in ${bucketText(bucketOf(over))}.`
        : `${itemText(active.id)} dropped. Nothing changed.`,
    onDragCancel: ({ active }) => `Moving ${itemText(active.id)} cancelled.`,
  };

  /** Put `itemId` in `bucketId` (empty to take it back out). */
  function place(itemId: string, bucketId: string) {
    const next: Record<string, string> = {};
    for (const item of question.items) {
      const bucket = item.id === itemId ? bucketId : placements[item.id];
      if (bucket) next[item.id] = bucket;
    }
    onChange({ type: 'categorize', placements: next });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over) return;
    const itemId = String(active.id);
    if ((placements[itemId] ?? '') !== bucketOf(over)) place(itemId, bucketOf(over));
  }

  const card = (item: Item) => (
    <ItemCard
      key={item.id}
      item={item}
      buckets={question.buckets}
      bucket={placements[item.id] ?? ''}
      locked={locked}
      expected={correct ? (correct[item.id] ?? '') : null}
      layoutId={`${id}-${item.id}`}
      layoutKey={layoutKey}
      selects={selects}
      onPlace={(bucketId) => {
        focusAfterMove.current = item.id;
        place(item.id, bucketId);
      }}
    />
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragEnd={onDragEnd}
      accessibility={{ announcements }}
    >
      <div role="group" aria-labelledby={labelledBy} className="space-y-3">
        {!feedback && (
          <p className="text-sm text-muted">Pick a bucket from each item's menu, or drag the item into a bucket.</p>
        )}
        {!(feedback && unplaced.length === 0) && (
          <Zone id={`${id}-pool`} bucket="" label={UNPLACED} empty="Every item is placed." locked={locked}>
            {unplaced.map(card)}
          </Zone>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {question.buckets.map((bucket) => (
            <Zone key={bucket.id} id={bucket.id} bucket={bucket.id} label={bucket.text} empty="Nothing here yet." locked={locked}>
              {question.items.filter((i) => placements[i.id] === bucket.id).map(card)}
            </Zone>
          ))}
        </div>
      </div>
    </DndContext>
  );
}

function Zone({
  id,
  bucket,
  label,
  empty,
  locked,
  children,
}: {
  id: string;
  bucket: string;
  label: string;
  empty: string;
  locked: boolean;
  children: ReactNode[];
}) {
  const labelId = useId();
  const { setNodeRef, isOver } = useDroppable({ id, data: { bucket }, disabled: locked });
  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-labelledby={labelId}
      className={`rounded-lg border p-3 ${isOver ? 'border-dashed border-accent' : 'border-border'}`}
    >
      <p id={labelId} className="mb-2 text-sm font-semibold">
        {label}
      </p>
      {children.length > 0 ? (
        <ul role="list" className="space-y-2">
          {children}
        </ul>
      ) : (
        <p className="text-sm text-muted">{empty}</p>
      )}
    </div>
  );
}

function ItemCard({
  item,
  buckets,
  bucket,
  locked,
  expected,
  layoutId,
  layoutKey,
  selects,
  onPlace,
}: {
  item: Item;
  buckets: Item[];
  bucket: string;
  locked: boolean;
  /** The correct bucket's id once the answer has been marked. */
  expected: string | null;
  layoutId: string;
  layoutKey: string;
  selects: RefObject<Map<string, HTMLSelectElement>>;
  onPlace(bucketId: string): void;
}) {
  const id = useId();
  const { setNodeRef, listeners, transform, isDragging } = useDraggable({ id: item.id, disabled: locked });
  const marked = expected !== null;
  const ok = bucket === expected;
  const expectedText = buckets.find((b) => b.id === expected)?.text;
  const border = marked ? (ok ? 'border-ok' : 'border-bad') : isDragging ? 'border-accent' : 'border-border';

  return (
    <li
      ref={setNodeRef}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }}
      className={isDragging ? 'relative z-10' : undefined}
    >
      {/* Shared layout id: the card glides from its old list to its new one. Measured only when placements
          change, so it does not trail the pointer during a drag. */}
      <motion.div
        layoutId={layoutId}
        layout="position"
        layoutDependency={layoutKey}
        className={`rounded-md border bg-surface p-2 ${border} ${isDragging ? 'shadow-lg' : ''}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            {...listeners}
            className={`min-w-0 flex-1 basis-32 touch-manipulation select-none py-1 [-webkit-touch-callout:none] ${
              locked ? '' : 'cursor-grab'
            }`}
          >
            {item.text}
          </span>
          <select
            ref={(el) => {
              if (el) selects.current.set(item.id, el);
              else selects.current.delete(item.id);
            }}
            aria-label={`Bucket for ${item.text}`}
            aria-describedby={marked ? `${id}-mark` : undefined}
            className="min-w-0 rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-text disabled:cursor-not-allowed"
            value={bucket}
            disabled={locked}
            onChange={(e) => onPlace(e.target.value)}
          >
            <option value="">Not placed</option>
            {buckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.text}
              </option>
            ))}
          </select>
        </div>
        {marked && (
          <div id={`${id}-mark`} className="mt-1">
            <Mark ok={ok}>{ok ? 'Correct' : expectedText ? `Incorrect. Belongs in: ${expectedText}` : 'Incorrect'}</Mark>
          </div>
        )}
      </motion.div>
    </li>
  );
}
