import type { ReactNode } from 'react';
import { Footer } from '../../ui/Footer';

/** Page frame for the screens outside the app shell (login, invite, reset, session loading). */
export function AuthLayout({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 p-4">
        {title && <h1 className="text-2xl font-semibold">{title}</h1>}
        {children}
      </main>
      <Footer />
    </div>
  );
}
