/**
 * @visastack/adapters — concrete infrastructure adapters that satisfy the
 * service-layer ports. Storage: Neon-bytea (dev/test/legacy, reduced-control)
 * and Vercel Private Blob (pilot/commercial-track). Scanning: a built-in
 * structural safety scanner. Swap for S3+KMS/ClamAV later behind the same
 * interfaces with no domain change (ADR-0011).
 */

export { type BlobTokenFields, signBlobToken, verifyBlobToken } from './blob-token';

export { NeonBlobStorage, type NeonBlobStorageOptions } from './neon-blob';

export { VercelPrivateBlobStorage, type VercelPrivateBlobStorageOptions } from './vercel-blob';

export {
  BasicSafetyScanner,
  type BasicSafetyScannerOptions,
  type StructuralCheckOptions,
  type StructuralCheckResult,
  structuralCheck,
} from './scanner';

export {
  ClamAvScanner,
  type ClamAvScannerOptions,
  checkSignatureFreshness,
  probeClamdVersion,
} from './clamav-scanner';

export {
  DeterministicTextExtractor,
  type DeterministicTextExtractorOptions,
} from './text-extraction';

export { BuiltinPreviewRenderer } from './preview-renderer';

export {
  BuiltinContentLimitsChecker,
  type BuiltinContentLimitsCheckerOptions,
  type ContentLimitsConfig,
} from './content-limits';

export {
  type ImageDimensions,
  imageDimensions,
  jpegDimensions,
  pngDimensions,
} from './image-dimensions';

export {
  OpenAiExtractionAdapter,
  type OpenAiExtractionAdapterOptions,
} from './openai-extraction';

export {
  AnthropicExtractionAdapter,
  type AnthropicExtractionAdapterOptions,
} from './anthropic-extraction';

export { NullEmailPort, ResendEmailPort, type ResendEmailPortOptions } from './email';
export { type SvixWebhookHeaders, verifyResendWebhookSignature } from './resend-webhook';

export { NullPaymentPort } from './payment';

export { ConsoleObservabilityPort } from './observability';

export {
  LocalEnvelopeKeyProvider,
  type LocalEnvelopeKeyProviderOptions,
} from './key-management';

export { JszipBundler } from './zip-bundler';
