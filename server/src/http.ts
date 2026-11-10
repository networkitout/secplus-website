/** Header every state-changing API request must carry (checked by the CSRF middleware, preset by test helpers). */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'secplus';
