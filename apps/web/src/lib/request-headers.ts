/**
 * The request header that carries the page address to the render, on every page request. It is set
 * by the middleware (`csp-middleware.ts`), which always overwrites anything a client sent, and read
 * by the root layout (page language) and the workspace layout (case sidebar). Kept in its own file
 * so a layout does not pull the middleware code in just to read a name.
 */
export const PATHNAME_REQUEST_HEADER = 'x-vs-pathname';
