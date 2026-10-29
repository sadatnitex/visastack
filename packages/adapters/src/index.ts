/**
 * @visastack/adapters — concrete infrastructure adapters that satisfy the
 * service-layer ports. Storage: Neon-bytea (dev/test/legacy, reduced-control)
 * and Vercel Private Blob (pilot/commercial-track). Scanning: a built-in
 * structural safety scanner. Swap for S3+KMS/ClamAV later behind the same
 * interfaces with no domain change (ADR-0011).
 */

export { type BlobTokenFields, signBlobToken, verifyBlobToken } from './blob-token';

export {
  AWS_KMS_KEY_VERSION,
  AWS_KMS_WRAPPING_PREFIX,
  AwsKmsKeyProvider,
  type AwsKmsKeyProviderOptions,
  type KmsClientLike,
} from './aws-kms-key-provider';
export { NeonBlobStorage, type NeonBlobStorageOptions } from './neon-blob';

export { VercelPrivateBlobStorage, type VercelPrivateBlobStorageOptions } from './vercel-blob';
export {
  R2Storage,
  R2_DOCUMENT_BUCKET,
  validateR2Endpoint,
  probeR2Storage,
  type R2StorageOptions,
} from './r2-storage';

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

export {
  SharpImageSanitizer,
  SharpPhotoReencoder,
  type SharpPhotoReencoderOptions,
} from './photo-reencoder';
export { BuiltinPreviewRenderer } from './preview-renderer';

export {
  PHOTO_SIZER_FORMATS,
  PHOTO_SIZER_LIMIT_INPUT_PIXELS,
  PHOTO_SIZER_TIMEOUT_SECONDS,
  UnsupportedPhotoFormatError,
  createPhotoSizer,
  setJpegDensity,
} from './photo-sizer';

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

export { GeminiExtractionAdapter, type GeminiExtractionAdapterOptions } from './gemini-extraction';

export { OpenAiOcrAdapter, type OpenAiOcrAdapterOptions } from './openai-ocr';

export { AnthropicOcrAdapter, type AnthropicOcrAdapterOptions } from './anthropic-ocr';

export { GeminiOcrAdapter, type GeminiOcrAdapterOptions } from './gemini-ocr';

export {
  type EvaluationCaseCallback,
  type EvaluationSuiteResult,
  runEvaluationSuite,
} from './eval/harness';
export {
  type AggregateReport,
  type CaseScore,
  PASS_THRESHOLDS,
  passesThresholds,
} from './eval/scoring';

export { NullEmailPort, ResendEmailPort, type ResendEmailPortOptions } from './email';
export { type SvixWebhookHeaders, verifyResendWebhookSignature } from './resend-webhook';

export {
  NullPaymentPort,
  SslcommerzPaymentPort,
  type PaymentProviderFailure,
  type SslcommerzMode,
  type SslcommerzPaymentPortOptions,
  normalizeSslcommerzRecord,
} from './payment';

export { ConsoleObservabilityPort } from './observability';

export {
  LocalEnvelopeKeyProvider,
  type LocalEnvelopeKeyProviderOptions,
} from './key-management';

export { JszipBundler } from './zip-bundler';

export { BACKUP_FRESHNESS_MAX_AGE_MS, hasRecentDatabaseBackup } from './backup-status';

export { WhatsAppCloudPort, type WhatsAppCloudPortOptions, toGraphMessage } from './whatsapp-cloud';

// UX-B: iPhone photos (HEIC or HEIF) converted to JPEG before they are stored.
export {
  HeicConversionError,
  type HeicConversionFailure,
  type HeicConversionResult,
  HeicJpegConverter,
  type HeicJpegConverterOptions,
  looksLikeHeic,
} from './heic-converter';
