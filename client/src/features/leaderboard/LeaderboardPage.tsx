import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client';
import type { DashboardSummary, LeaderboardPeriod, LeaderboardResponse } from '../../api/types';
import { QueryStatus } from '../../ui/QueryStatus';
import { useAuth } from '../auth/AuthProvider';

const TABS: Array<{ period: LeaderboardPeriod; label: string }> = [
  { period: 'week', label: 'This week' },
  { period: 'all', label: 'All time' },
];

const MEDALS = [
  { label: 'First place', tone: 'text-warn' },
  { label: 'Second place', tone: 'text-muted' },
  { label: 'Third place', tone: 'text-accent' },
];

const LINK = 'text-accent underline underline-offset-2';
const CELL = 'px-3 py-2';
const NUMBER = `${CELL} text-right font-mono`;
const MINE = 'bg-accent/10 font-semibold';

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** A medal for one of the first three places. Its colour is decoration: the place is in its label and in the number next to it. */
function Medal({ rank }: { rank: number }) {
  const medal = MEDALS[rank - 1];
  if (!medal) return null;
  return (
    <svg viewBox="0 0 20 24" width="18" height="22" role="img" aria-label={medal.label} focusable="false" className={`inline-block shrink-0 ${medal.tone}`}>
      <path d="M5 1h4l1 6H7zM11 1h4l-2 6h-3z" fill="currentColor" opacity="0.6" />
      <circle cx="10" cy="15" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="10" cy="15" r="3.5" fill="currentColor" />
    </svg>
  );
}

function Board({ board }: { board: LeaderboardResponse }) {
  const { user } = useAuth();
  const reduced = useReducedMotion();
  // The viewer's own level and streak, for their row when it is beyond the rows the server sent.
  const mine = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardSummary>('dashboard'),
    staleTime: Infinity,
    throwOnError: false,
  });
  const week = board.period === 'week';
  const { rows, me } = board;
  const pinned = me !== null && !rows.some((r) => r.isMe) ? me : null;

  return (
    <div className="space-y-4">
      {user?.hideFromLeaderboard ? (
        <p className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
          {'You are hidden from the leaderboard, so other learners do not see you here. You can change this in '}
          <Link to="/settings" className={LINK}>
            Settings
          </Link>
          .
        </p>
      ) : (
        me === null &&
        rows.length > 0 && (
          <p className="text-sm text-muted">{`You have no XP ${week ? 'this week ' : ''}yet, so you are not on the board.`}</p>
        )
      )}
      {rows.length === 0 ? (
        <p>{week ? 'No XP yet this week — be the first.' : 'No XP yet — be the first.'}</p>
      ) : (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{`Leaderboard: ${week ? 'this week' : 'all time'}`}</caption>
          <thead>
            <tr className="border-b border-border text-muted">
              <th scope="col" className={`${CELL} font-medium`}>Rank</th>
              <th scope="col" className={`${CELL} font-medium`}>Name</th>
              <th scope="col" className={`${CELL} text-right font-medium`}>Level</th>
              <th scope="col" className={`${CELL} text-right font-medium`}>{week ? 'XP this week' : 'XP'}</th>
              <th scope="col" className={`${CELL} text-right font-medium`}>Streak</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <motion.tr
                key={r.userId}
                layout={reduced ? false : 'position'}
                aria-current={r.isMe ? 'true' : undefined}
                className={`border-b border-border ${r.isMe ? MINE : ''}`}
              >
                <td className={CELL}>
                  <span className="inline-flex items-center gap-1.5 font-mono">
                    <Medal rank={r.rank} />
                    {r.rank}
                  </span>
                </td>
                <td className={`${CELL} break-words`}>{r.isMe ? `${r.name} (you)` : r.name}</td>
                <td className={NUMBER}>{r.level}</td>
                <td className={NUMBER}>{r.xp}</td>
                <td className={NUMBER}>{days(r.streak)}</td>
              </motion.tr>
            ))}
            {pinned && (
              <tr aria-current="true" className={`border-t-2 border-accent ${MINE}`}>
                <td className={`${CELL} font-mono`}>
                  <span className="sr-only">Your rank: </span>
                  {pinned.rank}
                </td>
                <td className={`${CELL} break-words`}>{`${user?.name ?? 'You'} (you)`}</td>
                <td className={NUMBER}>{mine.data ? mine.data.level : <Unknown />}</td>
                <td className={NUMBER}>{pinned.xp}</td>
                <td className={NUMBER}>{mine.data ? days(mine.data.streak) : <Unknown />}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Unknown() {
  return (
    <>
      <span aria-hidden="true">–</span>
      <span className="sr-only">not loaded</span>
    </>
  );
}

export function LeaderboardPage() {
  const [period, setPeriod] = useState<LeaderboardPeriod>('week');
  // While the other period loads, the rows on screen stay: when the new ones arrive, each learner's row
  // moves to its new place.
  const board = useQuery({
    queryKey: ['leaderboard', period],
    queryFn: () => api.get<LeaderboardResponse>(`leaderboard?period=${period}`),
    placeholderData: keepPreviousData,
  });
  const tabs = useRef<HTMLDivElement>(null);
  const id = useId();
  const tabId = (p: LeaderboardPeriod) => `${id}-tab-${p}`;
  const panelId = `${id}-panel`;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const at = TABS.findIndex((t) => t.period === period);
    const to =
      e.key === 'ArrowRight' ? (at + 1) % TABS.length
      : e.key === 'ArrowLeft' ? (at - 1 + TABS.length) % TABS.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? TABS.length - 1
      : -1;
    const target = TABS[to];
    if (!target) return;
    e.preventDefault();
    setPeriod(target.period);
    tabs.current?.querySelector<HTMLElement>(`[id="${tabId(target.period)}"]`)?.focus();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Leaderboard</h1>
        <p className="text-muted">Everyone sees the same board. It shows names, levels, XP and streaks, and nothing else about anyone.</p>
      </div>
      <div ref={tabs} role="tablist" aria-label="Period" onKeyDown={onKeyDown} className="flex gap-1 border-b border-border">
        {TABS.map((t) => {
          const selected = t.period === period;
          return (
            <button
              key={t.period}
              type="button"
              role="tab"
              id={tabId(t.period)}
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => setPeriod(t.period)}
              className={`-mb-px rounded-t-md border-b-2 px-4 py-2 text-sm ${
                selected ? 'border-accent font-semibold text-text' : 'border-transparent text-muted hover:text-text'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(period)}
        aria-busy={board.isPlaceholderData || undefined}
        tabIndex={0}
        className="space-y-4 rounded-sm"
      >
        <QueryStatus query={board} what="the leaderboard" />
        {board.data && <Board board={board.data} />}
      </div>
    </div>
  );
}
