export const XP = {
  lessonComplete: 50,
  firstCorrect: 10, // × difficulty
  repeatCorrect: 2,
  flashcardKnown: 2,
  objectiveQuizPass: 100,
  domainExamPass: 300,
  mockExamPass: 500,
  labPass: 75,
} as const;

export function levelForXp(xp: number): number {
  return 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 100));
}

export function xpForLevel(level: number): number {
  return 100 * (level - 1) ** 2;
}

export const BADGES: { id: string; title: string; description: string }[] = [
  { id: 'first-lesson', title: 'First Lesson', description: 'Complete your first lesson.' },
  { id: 'first-quiz-pass', title: 'Quiz Passer', description: 'Pass an objective quiz.' },
  { id: 'domain-1-complete', title: 'Domain 1 Complete', description: 'Pass the Domain 1 exam.' },
  { id: 'streak-3', title: 'Three-Day Streak', description: 'Study three days in a row.' },
  { id: 'streak-7', title: 'Week Streak', description: 'Study seven days in a row.' },
  { id: 'streak-30', title: 'Month Streak', description: 'Study thirty days in a row.' },
  { id: 'hundred-correct', title: 'Hundred Correct', description: 'Answer 100 questions correctly.' },
  { id: 'lab-rat', title: 'Lab Rat', description: 'Pass three different labs.' },
  { id: 'first-mock-pass', title: 'Mock Exam Passed', description: 'Pass a mock exam.' },
];
