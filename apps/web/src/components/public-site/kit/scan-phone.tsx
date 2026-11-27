import { DocumentPicture } from '../../pictures/document-picture';
import { publicString, publicText } from '../public-text';
import { ExampleTag, StatusChip } from '../story';
import { englishOn } from './doc-kinds';
import './kit-steps.css';
import './kit.css';

export type ScanStep = 0 | 1 | 2;

export interface ScanField {
  readonly label: string;
  readonly value: string;
}

export interface ScanPhoneProps {
  /** The fields the page reads (made-up values: the part carries the Example tag). */
  readonly fields: readonly ScanField[];
  /**
   * Pins one state: 0 the camera, 1 fields Suggested, 2 fields Confirmed. Leave out inside a scene
   * with three steps: the scene's step decides, and the finished state is 2.
   */
  readonly step?: ScanStep;
  readonly pageLang?: string;
}

/**
 * A phone: the camera scans a passport, the fields appear marked Suggested, then flip to
 * Confirmed. Nothing is saved as true until the person confirms (Suggested is not Confirmed).
 */
export function ScanPhone({ fields, step, pageLang = 'en' }: ScanPhoneProps) {
  const say = (text: string) => publicText(text, pageLang);
  const caption = publicString('Example of a document being read on a phone', pageLang);
  const fixed = step === undefined ? {} : { 'data-kit-step': step };
  return (
    <figure
      className={step === undefined ? 'kit-phone' : 'kit-phone kit-fixed'}
      data-pub-depth=""
      aria-label={caption.text}
      {...(caption.lang ? { lang: caption.lang } : {})}
      {...fixed}
      {...englishOn(pageLang)}
    >
      <span className="kit-phone-notch" aria-hidden="true" />
      <div className="kit-phone-screen">
        <b className="kit-phone-title">{say('Add Document')}</b>
        <div className="kit-cam" aria-hidden="true">
          <span className="kit-cam-corner" data-corner="a" />
          <span className="kit-cam-corner" data-corner="b" />
          <span className="kit-cam-corner" data-corner="c" />
          <span className="kit-cam-corner" data-corner="d" />
          <span className="kit-cam-doc">
            <DocumentPicture type="PASSPORT" size={86} />
          </span>
          <span className="kit-scan" data-upto="1" />
        </div>
        <ul className="kit-fields">
          {fields.map((field, index) => (
            <li className="kit-field" data-from="1" key={field.label} data-i={index}>
              <span className="kit-field-label">{say(field.label)}</span>
              <b className="kit-field-value">{say(field.value)}</b>
              <span className="kit-sw kit-chip-slot" data-upto="1">
                <StatusChip status="suggested" pageLang={pageLang} />
              </span>
              <span className="kit-sw kit-chip-slot" data-from="2">
                <StatusChip status="confirmed" pageLang={pageLang} />
              </span>
            </li>
          ))}
        </ul>
        <p className="kit-phone-note">
          <ExampleTag pageLang={pageLang} />
          <span>{say('Example record.')}</span>
        </p>
      </div>
    </figure>
  );
}
