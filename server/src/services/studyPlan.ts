const DAY_MS = 86_400_000;

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!) / DAY_MS;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function studyPlan(i: {
  today: string;
  examDate: string | null;
  objectivesRemaining: number;
  reviewsDue: number;
}): { daysLeft: number; objectivesPerDay: number; message: string } | null {
  if (!i.examDate) return null;
  const daysLeft = dayNumber(i.examDate) - dayNumber(i.today);
  const objectivesPerDay = Math.ceil(i.objectivesRemaining / Math.max(daysLeft, 1));

  let message: string;
  if (daysLeft < 0) message = 'Your exam date has passed. Update it in settings.';
  else if (i.objectivesRemaining === 0) {
    message = daysLeft === 0 ? 'Your exam is today. Every objective quiz is passed.' : `${plural(daysLeft, 'day', 'days')} to your exam. Every objective quiz is passed.`;
  } else {
    const lead = daysLeft === 0 ? 'Your exam is today' : `${plural(daysLeft, 'day', 'days')} to your exam`;
    const reviews = i.reviewsDue > 0 ? ` and clear ${plural(i.reviewsDue, 'review', 'reviews')} today` : '';
    message = `${lead}: pass ${plural(objectivesPerDay, 'objective quiz', 'objective quizzes')} a day${reviews}.`;
  }
  return { daysLeft, objectivesPerDay, message };
}
