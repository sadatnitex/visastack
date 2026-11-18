import { Icon } from '../../icons';
import { DocumentPicture } from '../../pictures/document-picture';
import { publicText } from '../public-text';
import { ExampleTag } from '../story';
import { DOC_TYPE, englishOn } from './doc-kinds';
import './kit-steps.css';
import './kit.css';

export type ShareStep = 0 | 1 | 2 | 3 | 4;

/** Steps in the story: nothing leaves, one paper and its part, add another, an end date, ended. */
export const SHARE_STEPS = 5;

const ROWS = [
  { kind: 'passport', name: 'Passport', part: 'Photo page only', from: 1 },
  { kind: 'photo', name: 'Photo', part: 'Visa size', from: 2 },
  { kind: 'bank', name: 'Bank', part: 'Visa size', from: 99 },
] as const;

/**
 * The picture of a sharing screen: switches per paper, who can see what, an end date and, at the
 * end, `Access Ended`. Saved is not Shared: every switch starts off, and a paper says
 * `Not shared` until it is switched on. The one markup serves every step (see kit-steps.css).
 */
export function ShareSheetBody({
  step,
  pageLang = 'en',
}: { readonly step?: ShareStep; readonly pageLang?: string }) {
  const say = (text: string) => publicText(text, pageLang);
  const fixed = step === undefined ? {} : { 'data-kit-step': step };
  return (
    <figure
      className={step === undefined ? 'kit-sheet' : 'kit-sheet kit-fixed'}
      data-pub-depth=""
      aria-label="Example of sharing papers with an agency"
      {...fixed}
      {...englishOn(pageLang)}
    >
      <ExampleTag pageLang={pageLang} />
      <div className="kit-sheet-main">
        <b className="kit-sheet-title">Share with Agency</b>
        {ROWS.map((row) => (
          <div className="kit-share-row" key={row.kind}>
            <span className="kit-row-pic">
              <DocumentPicture type={DOC_TYPE[row.kind]} size={34} />
            </span>
            <div className="kit-share-text">
              <b>{row.name}</b>
              {row.from < 99 ? (
                <>
                  <span className="kit-sw kit-share-part" data-upto={row.from - 1}>
                    {say('Not Shared')}
                  </span>
                  <span className="kit-sw kit-share-part" data-from={row.from}>
                    {say(row.part)}
                  </span>
                </>
              ) : (
                <span className="kit-share-part">{say('Not Shared')}</span>
              )}
            </div>
            <span className="kit-switch" {...(row.from < 99 ? { 'data-from': row.from } : {})} />
          </div>
        ))}
        <div className="kit-see">
          <span className="kit-sw kit-see-none" data-upto="0">
            {say('Agency can see nothing.')}
          </span>
          <span className="kit-sw kit-see-lead" data-from="1">
            {say('Agency can see:')}
          </span>
          <em className="kit-sw kit-see-chip" data-from="1">
            {say('Passport, photo page')}
          </em>
          <em className="kit-sw kit-see-chip" data-from="2">
            {say('Photo')}
          </em>
        </div>
        <div className="kit-sw kit-fine" data-from="3">
          <Icon name="clock" size={16} />
          <span>{say('Ends 31 Dec. Turn it off any time.')}</span>
        </div>
        <span className="kit-sheet-button">
          <span className="kit-sw" data-upto="2">
            {say('Share')}
          </span>
          <span className="kit-sw" data-from="3">
            {say('Turn Off')}
          </span>
        </span>
      </div>
      <div className="kit-sw kit-ended" data-from="4">
        <Icon name="lock" size={36} />
        <b>{say('Access Ended')}</b>
        <span>{say('Everything is private again.')}</span>
      </div>
    </figure>
  );
}
