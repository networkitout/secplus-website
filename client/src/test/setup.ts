import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';
import { resetPressClock } from './pressClock';

beforeEach(resetPressClock);

// jsdom has no layout: it reports `window.scrollTo`, which the app calls on a change of page, as not implemented.
window.scrollTo = () => {};
