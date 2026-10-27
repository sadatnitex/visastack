import 'server-only';
import { type AiReadingPorts, type Db, renderOcrSourceImage } from '@visastack/services';
import { resolveAiExtractor, resolveOcrAdapter } from './ai';
import { ensureDocumentFieldsRegistered } from './field-registry';
import { createKeyManagementPort, createPreviewRenderer, createStorage } from './providers';

/**
 * What the automatic reading job needs from this app (S5, ADR 0019): which AI provider and key are
 * in force, and how to turn a file into a picture. The same resolvers the manual buttons use, so
 * the job reads with exactly the provider, limits and fallback the buttons would. Each answer is
 * worked out at most once per pass, because a pass can read several files and resolving a provider
 * decrypts its key.
 */
export function createAiReadingPorts(db: Db): AiReadingPorts {
  const encryption = createKeyManagementPort();
  let extraction: ReturnType<AiReadingPorts['extraction']> | undefined;
  let ocr: ReturnType<AiReadingPorts['ocr']> | undefined;
  return {
    extraction: () => {
      extraction ??= resolveAiExtractor(db, encryption);
      return extraction;
    },
    ocr: () => {
      ocr ??= resolveOcrAdapter(db, encryption);
      return ocr;
    },
    renderImage: (documentVersionId, applicantId) =>
      renderOcrSourceImage(
        db,
        createStorage(db),
        createPreviewRenderer(),
        documentVersionId,
        applicantId,
      ),
    prepareFields: async (documentVersionId) => {
      await ensureDocumentFieldsRegistered(db, documentVersionId);
    },
  };
}
