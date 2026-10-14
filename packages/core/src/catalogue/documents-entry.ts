/**
 * The small entry for code that only needs document names (labels, pick-lists). Importing this
 * instead of the whole catalogue keeps the 800 fields and the sections out of that code's bundle
 * and out of every test that happens to touch a label.
 */
export { CATALOGUE_DOCUMENTS } from './documents';
export { documentTypeName, resolveDocumentType } from './document-lookup';
