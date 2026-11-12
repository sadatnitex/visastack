import { humanizeCode } from '../../../../../lib/format-code';
import { fieldLabel } from '../../../../../lib/master-profile';

/** A person-readable name for what is being asked for, never the stored key. */
export function requestTarget(req: {
  readonly kind: string;
  readonly fieldKey?: string | null;
  readonly docType?: string | null;
}): string {
  if (req.kind === 'FIELD') {
    const label = req.fieldKey ? fieldLabel(req.fieldKey) : undefined;
    return label ?? (req.fieldKey ? humanizeCode(req.fieldKey) : 'Not specified');
  }
  return req.docType ? humanizeCode(req.docType) : 'Not specified';
}

/** "Detail: Passport Number" or "Document: Bank Statement". */
export function requestName(req: {
  readonly kind: string;
  readonly fieldKey?: string | null;
  readonly docType?: string | null;
}): string {
  return `${req.kind === 'FIELD' ? 'Detail' : 'Document'}: ${requestTarget(req)}`;
}
