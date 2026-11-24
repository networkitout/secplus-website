import { ConfirmDialog } from '../../ui/ConfirmDialog';

/** Asks before an exam is submitted, saying what is still open. */
export function SubmitDialog({
  unanswered,
  partial = 0,
  flagged,
  onConfirm,
  onCancel,
}: {
  /** Questions without a complete answer, the partly answered ones among them. */
  unanswered: number;
  /** How many of the unanswered questions are partly answered. */
  partial?: number;
  flagged: number;
  onConfirm(): void;
  onCancel(): void;
}) {
  return (
    <ConfirmDialog title="Submit exam?" confirmLabel="Submit now" cancelLabel="Keep working" onConfirm={onConfirm} onCancel={onCancel}>
      <p className="font-medium">
        {`${unanswered} unanswered, ${flagged} flagged.`}
        {partial > 0 && ` ${partial} of the unanswered ${partial === 1 ? 'is' : 'are'} partly answered.`}
      </p>
      <p className="text-sm text-muted">
        {unanswered > 0 ? 'Unanswered questions count as wrong. ' : ''}You can't change your answers after you submit.
      </p>
    </ConfirmDialog>
  );
}
