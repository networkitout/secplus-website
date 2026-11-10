import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

const styles: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:opacity-90',
  secondary: 'border border-border bg-surface text-text hover:border-accent',
  danger: 'bg-bad text-on-accent hover:opacity-90',
};

export function Button({
  variant = 'primary',
  className = '',
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
      {...rest}
    />
  );
}
