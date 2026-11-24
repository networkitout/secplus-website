import type { HTMLAttributes } from 'react';

export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-lg border border-border bg-surface p-5 ${className}`} {...rest} />;
}
