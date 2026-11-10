import type { DiagramName } from './diagrams.js';

export type Item = { id: string; text: string };

type QBase = {
  id: string;
  objective: string;
  difficulty: 1 | 2 | 3;
  prompt: string;
  explanation: string;
};

export type Question =
  | (QBase & { type: 'single'; options: Item[]; correct: string; why: Record<string, string> })
  | (QBase & { type: 'multi'; options: Item[]; correct: string[]; why: Record<string, string> })
  | (QBase & { type: 'order'; items: Item[]; correct: string[] })
  | (QBase & { type: 'match'; left: Item[]; right: Item[]; correct: Record<string, string> })
  | (QBase & { type: 'categorize'; items: Item[]; buckets: Item[]; correct: Record<string, string> });

export type Answer =
  | { type: 'single'; choice: string }
  | { type: 'multi'; choices: string[] }
  | { type: 'order'; order: string[] }
  | { type: 'match'; pairs: Record<string, string> }
  | { type: 'categorize'; placements: Record<string, string> };

type StripAnswer<Q> = Q extends unknown ? Omit<Q, 'correct' | 'explanation' | 'why'> : never;
export type PublicQuestion = StripAnswer<Question>;

export type Feedback = {
  correct: boolean;
  fraction: number;
  correctAnswer: Answer;
  explanation: string;
  why?: Record<string, string>;
};

export type Flashcard = { id: string; objective: string; term: string; definition: string };

export type LabStep = Question; // ids like "lab-1-01-s1"
export type Lab = {
  id: string;
  domain: number;
  objectives: string[];
  title: string;
  scenario: string;
  steps: LabStep[];
};

export type ManifestObjective = { id: string; title: string; published: boolean; minQuestions: number };
export type ManifestDomain = {
  id: number;
  title: string;
  weight: number;
  mockCount: number;
  objectives: ManifestObjective[];
};
export type Manifest = { exam: 'SY0-701'; domains: ManifestDomain[] };

export type LessonBlock =
  | { kind: 'html'; html: string }
  | { kind: 'diagram'; name: DiagramName }
  | { kind: 'check'; questionId: string };
export type LessonSection = { id: string; title: string; blocks: LessonBlock[] };
export type Lesson = { objective: string; title: string; minutes: number; sections: LessonSection[] };
