import { describeContentError, loadContent } from './loader.js';

try {
  const c = loadContent('content');
  console.log(
    `Content OK: ${c.questions.size} questions, ${c.lessons.size} lessons, ${c.labs.size} labs, ${c.flashcards.length} flashcards`,
  );
} catch (e) {
  console.error(describeContentError(e));
  process.exit(1);
}
