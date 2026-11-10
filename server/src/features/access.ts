import type { Content } from '../content/loader.js';
import type { Db } from '../db/db.js';
import { HttpError } from '../http.js';

/** Domain 1 is always open; domain N opens once the learner has passed the domain N-1 exam. */
export async function unlockedDomains(db: Db, content: Content, userId: number): Promise<number[]> {
  const rows = await db.query<{ scope: string }>(
    "SELECT DISTINCT scope FROM assessments WHERE user_id = ? AND kind = 'domain' AND passed = 1 AND scope IS NOT NULL",
    [userId],
  );
  const passed = new Set(rows.map((r) => r.scope));
  return content.manifest.domains.map((d) => d.id).filter((id) => id === 1 || passed.has(String(id - 1)));
}

/** 404 for unknown or unpublished objectives, 403 when the objective's domain is still locked. */
export async function assertObjectiveOpen(db: Db, content: Content, userId: number, objectiveId: string): Promise<void> {
  const objective = content.manifest.domains.flatMap((d) => d.objectives).find((o) => o.id === objectiveId);
  if (!objective || !objective.published) throw new HttpError(404, 'Objective not found');
  const domain = content.domainOf(objectiveId);
  if (!(await unlockedDomains(db, content, userId)).includes(domain.id)) {
    throw new HttpError(403, 'Pass the previous domain exam to unlock this domain');
  }
}
