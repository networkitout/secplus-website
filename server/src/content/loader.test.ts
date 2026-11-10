import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent } from './loader.js';

const FIXTURE = fileURLToPath(new URL('../test/fixtures/content', import.meta.url));

function readJson(p: string): any {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeJson(p: string, v: unknown): void {
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}

function brokenCopyOfFixture(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secplus-content-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  const q11 = path.join(dir, 'domains/1/1.1/questions.json');
  const lesson11 = path.join(dir, 'domains/1/1.1/lesson.md');
  const editQs = (fn: (qs: any[]) => void) => {
    const qs = readJson(q11);
    fn(qs);
    writeJson(q11, qs);
  };
  const firstOf = (qs: any[], type: string) => qs.find((q) => q.type === type);
  switch (name) {
    case 'duplicate question id':
      editQs((qs) => (qs[1].id = qs[0].id));
      break;
    case 'question objective not in manifest':
      editQs((qs) => (qs[0].objective = '9.9'));
      break;
    case 'single: correct not among option ids':
      editQs((qs) => (firstOf(qs, 'single').correct = 'zzz'));
      break;
    case 'single: an option has no why entry':
      editQs((qs) => delete firstOf(qs, 'single').why.a);
      break;
    case 'order: correct is not a permutation of item ids':
      editQs((qs) => (firstOf(qs, 'order').correct = ['i1', 'i1', 'i2', 'i3']));
      break;
    case 'match: a left id has no pair':
      editQs((qs) => delete firstOf(qs, 'match').correct.l1);
      break;
    case 'match: two left ids share one right id':
      editQs((qs) => {
        const correct = firstOf(qs, 'match').correct;
        const [a, b] = Object.keys(correct);
        correct[b] = correct[a];
      });
      break;
    case 'categorize: placement names unknown bucket':
      editQs((qs) => (firstOf(qs, 'categorize').correct.t1 = 'nope'));
      break;
    case 'empty explanation':
      editQs((qs) => (qs[0].explanation = ''));
      break;
    case 'published objective below minQuestions': {
      const m = path.join(dir, 'manifest.json');
      const manifest = readJson(m);
      manifest.domains[0].objectives[0].minQuestions = 13;
      writeJson(m, manifest);
      break;
    }
    case 'published objective without lesson.md':
      fs.rmSync(lesson11);
      break;
    case 'lesson references unknown diagram':
      fs.appendFileSync(lesson11, '\n:::diagram no-such-diagram\n');
      break;
    case 'lesson check references unknown question id':
      fs.appendFileSync(lesson11, '\n:::check q-9.9-999\n');
      break;
    case 'flashcard objective not in manifest': {
      const f = path.join(dir, 'flashcards.json');
      const cards = readJson(f);
      cards[0].objective = '9.9';
      writeJson(f, cards);
      break;
    }
    default:
      throw new Error(`unknown mutation: ${name}`);
  }
  return dir;
}

test('loads fixture content', () => {
  const c = loadContent(FIXTURE);
  expect(c.questions.size).toBe(24);
  expect(c.questionsFor('1.1')).toHaveLength(12);
  expect(c.publishedObjectives().map((o) => o.id)).toEqual(['1.1', '1.2']);
  expect(c.domainOf('1.2').id).toBe(1);
  expect(c.lessons.size).toBe(2);
  expect(c.flashcards).toHaveLength(4);
  const lab = c.labs.get('lab-1-01')!;
  expect(lab.steps).toHaveLength(5);
  expect(lab.steps.filter((s) => s.type === 'order')).toHaveLength(1);
  const order = lab.steps.find((s) => s.type === 'order')!;
  expect(order.type === 'order' && order.items).toHaveLength(4);
});

test.each([
  ['duplicate question id', 'id'],
  ['question objective not in manifest', 'objective'],
  ['single: correct not among option ids', 'correct'],
  ['single: an option has no why entry', 'why'],
  ['order: correct is not a permutation of item ids', 'correct'],
  ['match: a left id has no pair', 'correct'],
  ['match: two left ids share one right id', 'correct'],
  ['categorize: placement names unknown bucket', 'correct'],
  ['empty explanation', 'explanation'],
  ['published objective below minQuestions', 'minQuestions'],
  ['published objective without lesson.md', 'lesson'],
  ['lesson references unknown diagram', 'diagram'],
  ['lesson check references unknown question id', 'check'],
  ['flashcard objective not in manifest', 'objective'],
])('rejects: %s', (_name, field) => {
  expect(() => loadContent(brokenCopyOfFixture(_name))).toThrow(
    expect.objectContaining({ name: 'ContentError', field }),
  );
});

test('rejects a lab step whose objective is not one of the lab objectives', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secplus-content-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  const labFile = path.join(dir, 'labs/lab-1-01.json');
  const lab = readJson(labFile);
  lab.steps[0].objective = '1.2';
  writeJson(labFile, lab);
  expect(() => loadContent(dir)).toThrow(expect.objectContaining({ name: 'ContentError', field: 'objective' }));
});

test('real content directory is valid', () => {
  expect(() => loadContent('content')).not.toThrow();
});

test('parses lessons into sections and blocks', () => {
  const l = loadContent(FIXTURE).lessons.get('1.1')!;
  expect(l.sections.map((s) => s.title)).toEqual(['Overview', 'Check yourself']);
  expect(l.sections[1]!.blocks).toEqual([{ kind: 'check', questionId: 'q-1.1-001' }]);
});

test('rejects a lesson whose objective differs from its directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secplus-content-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  const f = path.join(dir, 'domains/1/1.1/lesson.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('objective: "1.1"', 'objective: "1.2"'));
  expect(() => loadContent(dir)).toThrow(expect.objectContaining({ name: 'ContentError', field: 'objective' }));
});
