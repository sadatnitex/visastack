import { ReadAloudButton } from '../../src/app/app/mission/[id]/read-aloud-button';
import { ReferenceCode } from '../../src/components/reference-code';
import { PageHeader, StatusBadge } from '../../src/components/ui';

/**
 * WP-PIC16 fixture: the real case header status line, drawn the way the case page draws it (the
 * status text, the Read This Aloud control, the Case Reference and the "not confirmed" badge),
 * followed by a row of tap targets so the gap below the control can be measured. Worst case: a long
 * made-up purpose, so the line is as full as it gets at 320 and 375 px.
 */
export default function Pic16MetaFixture() {
  return (
    <section className="section container">
      <PageHeader
        eyebrow="Case"
        title="Made-up visitor visa case"
        meta={
          <>
            <span id="case-status-line">
              Made-up Tourist Visit To A Long Named Place {' · '}
              In Progress
            </span>
            <ReadAloudButton sourceId="case-status-line" />
            <ReferenceCode code="C-7K2Q9M" label="Case Reference" />
            <StatusBadge tone="neutral">You have not confirmed this case yet</StatusBadge>
          </>
        }
      />
      <div id="next-row" className="page-actions" style={{ marginTop: '8px' }}>
        <button type="button" className="btn btn-secondary">
          Add Evidence
        </button>
      </div>
    </section>
  );
}
