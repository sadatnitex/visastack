import { fieldRegistryInput } from '@visastack/core/catalogue';
import { supportedFieldKeys } from '@visastack/core/catalogue/documents';
import { type Db, getDocumentTypeOfVersion, registerFieldDefinitions } from '@visastack/services';

/**
 * Server only. The registry shape of each named field, live or added by the catalogue. Live definitions
 * win, and every writer uses the same shape (`fieldRegistryInput` in @visastack/core/catalogue), so a key
 * registered once, by whoever gets there first, is the same entry either way.
 */
export function fieldDefinitionInputs(keys: readonly string[]) {
  return [...new Set(keys)].flatMap((key) => {
    const input = fieldRegistryInput(key);
    return input ? [input] : [];
  });
}

/**
 * Before an AI reading, registers the fields this kind of document carries, so a field the catalogue
 * added is offered from the first upload instead of only after someone has saved it once. Only that
 * document type's own fields are added, never the whole catalogue, so the model is not handed hundreds of
 * fields a document cannot hold. A document with no type, or a type with no list, changes nothing. Safe
 * to run any number of times. Returns how many fields were added.
 */
export async function ensureDocumentFieldsRegistered(
  db: Db,
  documentVersionId: string,
): Promise<number> {
  const docType = await getDocumentTypeOfVersion(db, documentVersionId);
  if (!docType) return 0;
  const supported = supportedFieldKeys(docType);
  if (!supported || supported.length === 0) return 0;
  return registerFieldDefinitions(db, fieldDefinitionInputs(supported));
}
