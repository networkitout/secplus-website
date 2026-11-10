import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Answer, Feedback, Item, PublicQuestion } from '../../../../shared/types';
import { Mark } from './FeedbackPanel';

type Direction = 'up' | 'down';

const INSTRUCTIONS = {
  draggable:
    'To reorder with the keyboard, press Space or Enter on a Reorder button, move the item with the arrow keys, ' +
    'then press Space or Enter again to drop it. Press Escape to cancel. ' +
    'The Move up and Move down buttons do the same job.',
};

export function OrderQuestion({
  question,
  value,
  onChange,
  feedback,
  locked,
  labelledBy,
}: {
  question: Extract<PublicQuestion, { type: 'order' }>;
  value: Extract<Answer, { type: 'order' }> | null;
  onChange(a: Answer): void;
  feedback?: Feedback;
  locked: boolean;
  labelledBy: string;
}) {
  const served = question.items.map((i) => i.id);
  const order = value?.order ?? served;
  const items = order.flatMap((id) => question.items.find((i) => i.id === id) ?? []);
  const correctOrder = feedback?.correctAnswer.type === 'order' ? feedback.correctAnswer.order : null;

  const [announcement, setAnnouncement] = useState('');
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const focusAfterMove = useRef<{ id: string; direction: Direction } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // An untouched list is already a complete answer, so report the served order as the starting value.
  const unanswered = value === null && !locked;
  useEffect(() => {
    if (unanswered) onChange({ type: 'order', order: served });
    // Deliberately keyed on `unanswered` alone: once per unanswered question, not on every new callback.
  }, [unanswered]);

  // Reordering moves the row's DOM node, which drops keyboard focus, and a row that reaches either end
  // has its pressed button disabled. Put focus back on the row's button that still works.
  useEffect(() => {
    const pending = focusAfterMove.current;
    if (!pending) return;
    focusAfterMove.current = null;
    const pressed = buttons.current.get(`${pending.id}:${pending.direction}`);
    const opposite = buttons.current.get(`${pending.id}:${pending.direction === 'up' ? 'down' : 'up'}`);
    (pressed && !pressed.disabled ? pressed : opposite)?.focus();
  });

  const text = (id: UniqueIdentifier) => question.items.find((i) => i.id === id)?.text ?? String(id);
  const position = (id: UniqueIdentifier) => `position ${order.indexOf(String(id)) + 1} of ${order.length}`;

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${text(active.id)}, ${position(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${text(active.id)} moved to ${position(over.id)}.` : undefined),
    onDragEnd: ({ active, over }) =>
      over ? `${text(active.id)} dropped at ${position(over.id)}.` : `${text(active.id)} dropped.`,
    onDragCancel: ({ active }) => `Reordering cancelled. ${text(active.id)} is back at ${position(active.id)}.`,
  };

  function move(id: string, direction: Direction) {
    const from = order.indexOf(id);
    const to = direction === 'up' ? from - 1 : from + 1;
    if (to < 0 || to >= order.length) return;
    focusAfterMove.current = { id, direction };
    setAnnouncement(`${text(id)} moved to position ${to + 1} of ${order.length}.`);
    onChange({ type: 'order', order: arrayMove(order, from, to) });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onChange({ type: 'order', order: arrayMove(order, from, to) });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{ announcements, screenReaderInstructions: INSTRUCTIONS }}
    >
      <SortableContext items={order} strategy={verticalListSortingStrategy} disabled={locked}>
        {/* role="list" keeps the list semantics that Safari drops when list markers are removed. */}
        <ol role="list" aria-labelledby={labelledBy} className="space-y-2">
          {items.map((item, index) => (
            <Row
              key={item.id}
              item={item}
              index={index}
              total={items.length}
              locked={locked}
              showControls={!feedback}
              layoutKey={order.join(' ')}
              correctIndex={correctOrder ? correctOrder.indexOf(item.id) : null}
              onMove={move}
              buttons={buttons}
            />
          ))}
        </ol>
      </SortableContext>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </DndContext>
  );
}

function Row({
  item,
  index,
  total,
  locked,
  showControls,
  layoutKey,
  correctIndex,
  onMove,
  buttons,
}: {
  item: Item;
  index: number;
  total: number;
  locked: boolean;
  showControls: boolean;
  layoutKey: string;
  /** Where this item belongs, once the answer has been marked. */
  correctIndex: number | null;
  onMove(id: string, direction: Direction): void;
  buttons: RefObject<Map<string, HTMLButtonElement>>;
}) {
  // Motion animates the row to its new place, so dnd-kit's own settle animation stays off.
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: locked,
    animateLayoutChanges: () => false,
  });
  const reduced = useReducedMotion();

  const register = (direction: Direction) => (el: HTMLButtonElement | null) => {
    if (el) buttons.current.set(`${item.id}:${direction}`, el);
    else buttons.current.delete(`${item.id}:${direction}`);
  };

  const marked = correctIndex !== null;
  const ok = correctIndex === index;
  const border = marked ? (ok ? 'border-ok' : 'border-bad') : isDragging ? 'border-accent' : 'border-border';
  const arrow =
    'inline-flex size-9 items-center justify-center rounded-md border border-border hover:border-accent disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        // Under reduced motion the stylesheet turns every transition into a one-frame delay, which would show
        // the rows out of place for a frame after a drop. No transition at all makes them snap.
        transition: reduced ? 'none' : transition,
      }}
      className={isDragging ? 'relative z-10' : undefined}
    >
      {/* Measured only when the order changes, so the row does not trail the pointer during a drag. */}
      <motion.div
        layout="position"
        layoutDependency={layoutKey}
        className={`flex items-center gap-2 rounded-md border bg-surface p-2 ${border} ${isDragging ? 'shadow-lg' : ''}`}
      >
        {showControls && (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            disabled={locked}
            aria-label={`Reorder: ${item.text}`}
            className="inline-flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="currentColor">
              <circle cx="5" cy="3" r="1.5" />
              <circle cx="11" cy="3" r="1.5" />
              <circle cx="5" cy="8" r="1.5" />
              <circle cx="11" cy="8" r="1.5" />
              <circle cx="5" cy="13" r="1.5" />
              <circle cx="11" cy="13" r="1.5" />
            </svg>
          </button>
        )}
        <span aria-hidden="true" className="w-6 shrink-0 text-center font-mono text-sm text-muted">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p>{item.text}</p>
          {marked && (
            <Mark ok={ok}>{ok ? 'Correct position' : `Incorrect. Correct position: ${correctIndex + 1}`}</Mark>
          )}
        </div>
        {showControls && (
          <div className="flex shrink-0 flex-col gap-1 sm:flex-row sm:gap-2">
            <button
              type="button"
              ref={register('up')}
              disabled={locked || index === 0}
              aria-label={`Move up: ${item.text}`}
              className={arrow}
              onClick={() => onMove(item.id, 'up')}
            >
              <span aria-hidden="true">↑</span>
            </button>
            <button
              type="button"
              ref={register('down')}
              disabled={locked || index === total - 1}
              aria-label={`Move down: ${item.text}`}
              className={arrow}
              onClick={() => onMove(item.id, 'down')}
            >
              <span aria-hidden="true">↓</span>
            </button>
          </div>
        )}
      </motion.div>
    </li>
  );
}
