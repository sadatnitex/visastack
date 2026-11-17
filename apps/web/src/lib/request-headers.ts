/**
 * The request header that carries the page address to the render, on every page request. It is set
 * by the middleware (`csp-middleware.ts`), which always overwrites anything a client sent, and read
 * by the root layout (page language) and the workspace layout (case sidebar). Kept in its own file
 * so a layout does not pull the middleware code in just to read a name.
 */
export const PATHNAME_REQUEST_HEADER = 'x-vs-pathname';

/**
 * The query string of the same request (with its leading `?`, or empty), set and overwritten the
 * same way. Together with the page address it lets a server-side redirect send a person on to
 * exactly where they were headed (an invitation link keeps its token in the query).
 */
export const SEARCH_REQUEST_HEADER = 'x-vs-search';
