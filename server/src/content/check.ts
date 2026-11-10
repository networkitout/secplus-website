import { ContentError, loadContent } from './loader.js';

try {
  const c = loadContent('content');
  console.log(
    `Content OK: ${c.questions.size} questions, ${c.lessons.size} lessons, ${c.labs.size} labs, ${c.flashcards.length} flashcards`,
  );
} catch (e) {
  if (e instanceof ContentError) console.error(`${e.file}: ${e.field}: ${e.message}`);
  else console.error(e);
  process.exit(1);
}
