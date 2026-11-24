/** Share (0-100, whole number) of the objective's questions whose latest attempt was correct; unseen questions count as not known. */
export function objectiveMastery(questionIds: string[], latestCorrect: Map<string, boolean>): number {
  if (questionIds.length === 0) return 0;
  const known = questionIds.filter((id) => latestCorrect.get(id) === true).length;
  return Math.round((known / questionIds.length) * 100);
}

/** Objective mastery weighted by each objective's question count. */
export function domainMastery(objs: { mastery: number; questionCount: number }[]): number {
  const total = objs.reduce((sum, o) => sum + o.questionCount, 0);
  if (total === 0) return 0;
  return Math.round(objs.reduce((sum, o) => sum + o.mastery * o.questionCount, 0) / total);
}

export const READY_MOCK_AVERAGE = 800;
export const READY_DOMAIN_MASTERY = 80;
const MOCKS_NEEDED = 3;
const DOMAIN_IDS = [1, 2, 3, 4, 5];

export function readiness(i: {
  domainMastery: Record<number, number>;
  lastMockScores: number[];
  allDomainsPublished: boolean;
}): { ready: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!i.allDomainsPublished) missing.push('Content for all five domains is not available yet');

  if (i.lastMockScores.length < MOCKS_NEEDED) {
    const n = MOCKS_NEEDED - i.lastMockScores.length;
    missing.push(`Take ${n} more mock ${n === 1 ? 'exam' : 'exams'}`);
  } else {
    const recent = i.lastMockScores.slice(-MOCKS_NEEDED);
    const mean = recent.reduce((a, b) => a + b, 0) / MOCKS_NEEDED;
    if (mean < READY_MOCK_AVERAGE) {
      missing.push(`Average of last three mock exams is ${Math.round(mean)}; aim for ${READY_MOCK_AVERAGE}`);
    }
  }

  for (const d of DOMAIN_IDS) {
    const m = i.domainMastery[d] ?? 0;
    if (m < READY_DOMAIN_MASTERY) missing.push(`Domain ${d} mastery is ${Math.round(m)}%; aim for ${READY_DOMAIN_MASTERY}%`);
  }
  return { ready: missing.length === 0, missing };
}
