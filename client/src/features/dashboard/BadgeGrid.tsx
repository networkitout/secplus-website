import type { DashboardBadge } from '../../api/types';
import { formatInstant } from '../../lib/dates';

function BadgeIcon({ earned }: { earned: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false" className={`shrink-0 ${earned ? 'text-accent' : 'text-muted'}`}>
      <circle cx="12" cy="9" r="6.5" fill={earned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeDasharray={earned ? undefined : '3 2'} />
      <path d="M8 14.5 6.5 22l5.5-3 5.5 3-1.5-7.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Every badge there is. An earned badge is in the accent colour and says when it was earned; one that is
 * not earned is dimmed, outlined with dashes and says so, with how to earn it.
 */
export function BadgeGrid({ badges, timeZone }: { badges: DashboardBadge[]; timeZone: string }) {
  return (
    <ul role="list" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {badges.map((badge) => {
        const earned = badge.earnedAt !== null;
        return (
          <li
            key={badge.id}
            className={`flex gap-3 rounded-lg border p-4 ${earned ? 'border-accent bg-surface' : 'border-dashed border-border text-muted'}`}
          >
            <BadgeIcon earned={earned} />
            <div className="min-w-0 space-y-1">
              <p className="font-semibold">{badge.title}</p>
              <p className="text-sm">{badge.description}</p>
              {badge.earnedAt !== null ? (
                <p className="text-sm text-ok">
                  <span aria-hidden="true">✓ </span>
                  {'Earned '}
                  <time dateTime={badge.earnedAt}>{formatInstant(badge.earnedAt, timeZone)}</time>
                </p>
              ) : (
                <p className="text-sm">Not earned yet</p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
