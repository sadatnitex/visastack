import { requestItemView } from '../../src/app/app/applicant/[id]/evidence/request-item';
export default function Probe() {
  const v = requestItemView({ request: { status: 'OPEN', kind: 'DOCUMENT' } });
  return <p>{v.statusLabel}</p>;
}
