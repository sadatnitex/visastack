import { CATALOGUE_DOCUMENTS, knownFieldOptions } from '@visastack/core';

/**
 * The pick-lists behind the admin name boxes. Rendered on the server, so the catalogue never ships
 * to the browser; an input chooses a list with its `list` attribute. People can still type, and the
 * server checks what they typed.
 */
export const DOCUMENT_TYPE_LIST_ID = 'catalogue-document-types';
export const FIELD_KEY_LIST_ID = 'catalogue-field-keys';

export function DocumentTypeDatalist() {
  return (
    <datalist id={DOCUMENT_TYPE_LIST_ID}>
      {CATALOGUE_DOCUMENTS.map((document) => (
        <option key={document.key} value={document.key}>
          {document.label}
        </option>
      ))}
    </datalist>
  );
}

export function FieldKeyDatalist() {
  return (
    <datalist id={FIELD_KEY_LIST_ID}>
      {knownFieldOptions().map((field) => (
        <option key={field.key} value={field.key}>
          {field.label}
        </option>
      ))}
    </datalist>
  );
}
