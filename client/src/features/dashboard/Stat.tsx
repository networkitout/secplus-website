import type { ReactNode } from 'react';

/**
 * One number with its name, as an item of a `<dl>`. `inset` is for a tile that lies on a card: it takes the
 * colour of the page, so that it stands out from the card.
 */
export function Stat({ label, inset = false, children }: { label: string; inset?: boolean; children: ReactNode }) {
  return (
    <div className={`rounded-lg border border-border p-4 ${inset ? 'bg-bg' : 'bg-surface'}`}>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-mono text-xl font-semibold">{children}</dd>
    </div>
  );
}
