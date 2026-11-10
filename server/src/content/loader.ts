import fs from 'node:fs';
import path from 'node:path';
import type { z } from 'zod';
import type { Flashcard, Lab, Lesson, Manifest, ManifestDomain, ManifestObjective, Question } from '../../../shared/types.js';
import { parseLesson } from './lesson.js';
import { flashcardsFileSchema, labSchema, manifestSchema, questionsFileSchema } from './schema.js';

export class ContentError extends Error {
  constructor(
    public file: string,
    public field: string,
    message: string,
  ) {
    super(message);
    this.name = 'ContentError';
  }
}

export type Content = {
  manifest: Manifest;
  questions: Map<string, Question>;
  questionsFor(objective: string): Question[];
  lessons: Map<string, Lesson>; // objective id -> parsed lesson.md
  labs: Map<string, Lab>;
  flashcards: Flashcard[];
  publishedObjectives(): ManifestObjective[];
  domainOf(objective: string): ManifestDomain;
};

function readText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new ContentError(file, 'file', `cannot read file: ${(e as Error).message}`);
  }
}

function parseWith<S extends z.ZodType>(schema: S, file: string): z.output<S> {
  let json: unknown;
  try {
    json = JSON.parse(readText(file));
  } catch (e) {
    if (e instanceof ContentError) throw e;
    throw new ContentError(file, 'json', `invalid JSON: ${(e as Error).message}`);
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    const named = [...issue.path].reverse().find((p) => typeof p === 'string');
    const where = issue.path.join('.');
    throw new ContentError(file, String(named ?? 'file'), `${where ? where + ': ' : ''}${issue.message}`);
  }
  return result.data;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === a.length && b.every((x) => a.includes(x));

/** Semantic checks beyond the schema. `ids` are the ids of the option/item lists. */
function checkQuestion(q: Question, file: string): void {
  const at = (field: string, msg: string) => new ContentError(file, field, `${q.id}: ${msg}`);
  const unique = (list: { id: string }[], what: string) => {
    if (new Set(list.map((i) => i.id)).size !== list.length) throw at('id', `duplicate ${what} ids`);
  };
  switch (q.type) {
    case 'single':
    case 'multi': {
      unique(q.options, 'option');
      const ids = q.options.map((o) => o.id);
      const correct = q.type === 'single' ? [q.correct] : q.correct;
      if (!correct.every((c) => ids.includes(c)) || new Set(correct).size !== correct.length)
        throw at('correct', 'correct must name distinct option ids');
      for (const id of ids) if (!q.why[id]) throw at('why', `option ${id} has no why entry`);
      if (Object.keys(q.why).some((k) => !ids.includes(k))) throw at('why', 'why names an unknown option');
      break;
    }
    case 'order': {
      unique(q.items, 'item');
      if (!sameSet(q.correct, q.items.map((i) => i.id)))
        throw at('correct', 'correct must be a permutation of the item ids');
      break;
    }
    case 'match': {
      unique(q.left, 'left');
      unique(q.right, 'right');
      const leftIds = q.left.map((i) => i.id);
      const rightIds = q.right.map((i) => i.id);
      if (!sameSet(Object.keys(q.correct), leftIds)) throw at('correct', 'every left id needs exactly one pair');
      if (!Object.values(q.correct).every((r) => rightIds.includes(r)))
        throw at('correct', 'a pair names an unknown right id');
      // The match UI pairs one-to-one, so a shared right item could never be answered.
      if (new Set(Object.values(q.correct)).size !== leftIds.length)
        throw at('correct', 'each left id must pair with a different right id');
      break;
    }
    case 'categorize': {
      unique(q.items, 'item');
      unique(q.buckets, 'bucket');
      if (!sameSet(Object.keys(q.correct), q.items.map((i) => i.id)))
        throw at('correct', 'every item needs exactly one placement');
      const bucketIds = q.buckets.map((b) => b.id);
      if (!Object.values(q.correct).every((b) => bucketIds.includes(b)))
        throw at('correct', 'a placement names an unknown bucket');
      break;
    }
  }
}

function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

export function loadContent(dir: string): Content {
  const manifestFile = path.join(dir, 'manifest.json');
  const manifest: Manifest = parseWith(manifestSchema, manifestFile);

  const objectives = new Map<string, ManifestObjective>();
  const domainByObjective = new Map<string, ManifestDomain>();
  for (const d of manifest.domains) {
    for (const o of d.objectives) {
      if (objectives.has(o.id)) throw new ContentError(manifestFile, 'id', `duplicate objective ${o.id}`);
      objectives.set(o.id, o);
      domainByObjective.set(o.id, d);
    }
  }

  const questions = new Map<string, Question>();
  const byObjective = new Map<string, Question[]>();
  const lessons = new Map<string, Lesson>();
  const lessonFiles = new Map<string, string>();

  for (const d of manifest.domains) {
    for (const o of d.objectives) {
      const objDir = path.join(dir, 'domains', String(d.id), o.id);
      const qFile = path.join(objDir, 'questions.json');
      if (fs.existsSync(qFile)) {
        for (const q of parseWith(questionsFileSchema, qFile)) {
          if (questions.has(q.id)) throw new ContentError(qFile, 'id', `duplicate question id ${q.id}`);
          if (q.objective !== o.id)
            throw new ContentError(qFile, 'objective', `${q.id}: objective ${q.objective} does not match ${o.id}`);
          checkQuestion(q, qFile);
          questions.set(q.id, q);
          byObjective.set(o.id, [...(byObjective.get(o.id) ?? []), q]);
        }
      }
      const lessonFile = path.join(objDir, 'lesson.md');
      if (fs.existsSync(lessonFile)) {
        const lesson = parseLesson(readText(lessonFile), lessonFile);
        if (lesson.objective !== o.id)
          throw new ContentError(lessonFile, 'objective', `lesson objective ${lesson.objective} does not match ${o.id}`);
        lessons.set(o.id, lesson);
        lessonFiles.set(o.id, lessonFile);
      }
    }
  }

  // Questions may only live under objectives of the manifest.
  for (const domainId of listDirs(path.join(dir, 'domains'))) {
    for (const objId of listDirs(path.join(dir, 'domains', domainId))) {
      if (domainByObjective.get(objId)?.id !== Number(domainId))
        throw new ContentError(path.join(dir, 'domains', domainId, objId), 'objective', `${objId} is not in the manifest under domain ${domainId}`);
    }
  }

  for (const o of objectives.values()) {
    if (!o.published) continue;
    const lessonFile = path.join(dir, 'domains', String(domainByObjective.get(o.id)!.id), o.id, 'lesson.md');
    if (!lessons.has(o.id)) throw new ContentError(lessonFile, 'lesson', `published objective ${o.id} has no lesson.md`);
    const count = byObjective.get(o.id)?.length ?? 0;
    if (count < o.minQuestions)
      throw new ContentError(manifestFile, 'minQuestions', `objective ${o.id} has ${count} questions, needs ${o.minQuestions}`);
  }

  // Check blocks may only name known questions (all questions are loaded by now).
  for (const [objId, lesson] of lessons) {
    for (const section of lesson.sections)
      for (const block of section.blocks)
        if (block.kind === 'check' && !questions.has(block.questionId))
          throw new ContentError(lessonFiles.get(objId)!, 'check', `unknown question id "${block.questionId}"`);
  }

  const labs = new Map<string, Lab>();
  const labsDir = path.join(dir, 'labs');
  const labFiles = fs.existsSync(labsDir) ? fs.readdirSync(labsDir).filter((f) => f.endsWith('.json')).sort() : [];
  const stepIds = new Set<string>();
  for (const f of labFiles) {
    const file = path.join(labsDir, f);
    const lab: Lab = parseWith(labSchema, file);
    if (labs.has(lab.id)) throw new ContentError(file, 'id', `duplicate lab id ${lab.id}`);
    for (const o of lab.objectives)
      if (!objectives.has(o)) throw new ContentError(file, 'objectives', `lab ${lab.id}: unknown objective ${o}`);
    for (const s of lab.steps) {
      if (stepIds.has(s.id) || questions.has(s.id)) throw new ContentError(file, 'id', `duplicate step id ${s.id}`);
      stepIds.add(s.id);
      if (!lab.objectives.includes(s.objective))
        throw new ContentError(file, 'objective', `${s.id}: objective ${s.objective} is not one of the lab's objectives`);
      checkQuestion(s, file);
    }
    labs.set(lab.id, lab);
  }

  const flashFile = path.join(dir, 'flashcards.json');
  const flashcards: Flashcard[] = parseWith(flashcardsFileSchema, flashFile);
  const flashIds = new Set<string>();
  for (const c of flashcards) {
    if (flashIds.has(c.id)) throw new ContentError(flashFile, 'id', `duplicate flashcard id ${c.id}`);
    flashIds.add(c.id);
    if (!objectives.has(c.objective))
      throw new ContentError(flashFile, 'objective', `${c.id}: objective ${c.objective} is not in the manifest`);
  }

  return {
    manifest,
    questions,
    questionsFor: (objective) => byObjective.get(objective) ?? [],
    lessons,
    labs,
    flashcards,
    publishedObjectives: () => [...objectives.values()].filter((o) => o.published),
    domainOf(objective) {
      const d = domainByObjective.get(objective);
      if (!d) throw new Error(`unknown objective ${objective}`);
      return d;
    },
  };
}
