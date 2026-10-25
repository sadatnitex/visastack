import {
  type AiDataMode,
  type AiDataRuleSetting,
  type AiProviderConfig,
  type AiProviderDataTerms,
  type AiTermsConcern,
  decideAiProviderUse,
  isAiTermsCheckDue,
} from '@visastack/services';
import { aiProviderLabel } from '../../../../lib/labels';
import { DataRuleForm } from './forms';

/** Plain words for why a configuration's terms do not show that it leaves inputs alone. */
export const TERMS_CONCERN_TEXT: Readonly<Record<AiTermsConcern, string>> = {
  trains_on_inputs: 'its terms say it may train on what it is sent',
  training_unknown: 'it is not known whether it trains on what it is sent',
  terms_unrecorded: 'no data terms have been recorded for it',
  terms_incomplete: 'it is recorded as not training, but without the address of those terms',
};

const TIER_TEXT = { FREE: 'Free', PAID: 'Paid', UNKNOWN: 'Not Recorded' } as const;
const TRAINS_TEXT = { YES: 'Yes', NO: 'No', UNKNOWN: 'Not Known' } as const;

function configName(config: AiProviderConfig): string {
  return `${aiProviderLabel(config.provider)}, ${config.model}`;
}

/** The recorded terms for one configuration, as rows inside its card. */
export function TermsRows({ terms }: { readonly terms: AiProviderDataTerms }) {
  if (!terms.recorded) {
    return (
      <div className="row">
        <span className="row-key">Data Terms</span>
        <span className="badge badge-warning">Not Recorded</span>
      </div>
    );
  }
  return (
    <>
      <div className="row">
        <span className="row-key">Plan</span>
        <span className="row-val">{TIER_TEXT[terms.tier]}</span>
      </div>
      <div className="row">
        <span className="row-key">May Train on Inputs</span>
        <span
          className={`badge ${terms.trainsOnInputs === 'NO' ? 'badge-success' : 'badge-warning'}`}
        >
          {TRAINS_TEXT[terms.trainsOnInputs]}
        </span>
      </div>
      <div className="row">
        <span className="row-key">Kept For</span>
        <span className="row-val">
          {terms.retentionDays === null ? 'Not Known' : `${terms.retentionDays} days`}
        </span>
      </div>
      <div className="row">
        <span className="row-key">Processed In</span>
        <span className="row-val">{terms.region ?? 'Not Known'}</span>
      </div>
      <div className="row">
        <span className="row-key">Terms</span>
        <span className="row-val">
          {terms.termsUrl && URL.canParse(terms.termsUrl) ? (
            <a href={terms.termsUrl} rel="noreferrer noopener" target="_blank">
              {new URL(terms.termsUrl).hostname}
            </a>
          ) : (
            'No Address Recorded'
          )}
        </span>
      </div>
      <div className="row">
        <span className="row-key">Checked</span>
        <span className="row-val">
          {terms.checkedOn}
          {isAiTermsCheckDue(terms) ? ' (check again)' : ''}
        </span>
      </div>
      {terms.notes ? (
        <div className="row">
          <span className="row-key">What the Terms Say</span>
          <span className="row-val">{terms.notes}</span>
        </div>
      ) : null}
    </>
  );
}

export interface DataTermsPanelProps {
  readonly mode: AiDataMode;
  readonly setting: AiDataRuleSetting;
  readonly termsAvailable: boolean;
  readonly active: AiProviderConfig | undefined;
  readonly fallback: AiProviderConfig | undefined;
  readonly termsFor: (configId: string) => AiProviderDataTerms;
}

/**
 * The top-of-page summary: which kind of data the platform holds, the
 * "Only Use AI Providers That Do Not Train on Inputs" switch, and a warning
 * for the active configuration and its fallback whenever real applicant data
 * is on and their terms do not show that inputs are left alone. Uses the
 * same `decideAiProviderUse` rule the gateway runs, so what this page says
 * and what the gateway does cannot disagree.
 */
export function DataTermsPanel(props: DataTermsPanelProps) {
  const checks = [
    { role: 'Active Provider', config: props.active },
    { role: 'Fallback', config: props.fallback },
  ].flatMap(({ role, config }) =>
    config
      ? [
          {
            role,
            config,
            decision: decideAiProviderUse({
              mode: props.mode,
              terms: props.termsFor(config.id),
              requireNoTraining: props.setting.requireNoTraining,
            }),
          },
        ]
      : [],
  );
  const blocked = checks.filter((c) => !c.decision.allowed);
  const warned = checks.filter((c) => c.decision.allowed && c.decision.warning !== null);
  const realData = props.mode === 'real_applicant_data';

  return (
    <article className="card u-mb-150">
      <p className="card-kicker">Data Terms</p>
      <h2 className="card-title">What AI Providers Do with What We Send</h2>
      <div className="rows u-mb-100">
        <div className="row">
          <span className="row-key">Data on This Platform</span>
          <span className={`badge ${realData ? 'badge-warning' : 'badge-neutral'}`}>
            {realData ? 'Real Applicant Data On' : 'Made-Up Data Only'}
          </span>
        </div>
        <div className="row">
          <span className="row-key">Only Use AI Providers That Do Not Train on Inputs</span>
          <span
            className={`badge ${props.setting.requireNoTraining ? 'badge-success' : 'badge-neutral'}`}
          >
            {props.setting.requireNoTraining ? 'On' : 'Off'}
          </span>
        </div>
      </div>
      {!props.termsAvailable ? (
        <div className="notice notice-warn u-mb-100">
          Data terms cannot be read yet because the latest database update has not been applied.
          Every provider reads as not recorded until it is.
        </div>
      ) : null}
      {props.setting.source === 'read_failed' ? (
        <div className="notice notice-warn u-mb-100">
          The setting could not be read, so it is treated as off until it can be. Providers are not
          blocked meanwhile.
        </div>
      ) : null}
      {blocked.map(({ role, config, decision }) => (
        <div className="notice notice-warn u-mb-100" key={`blocked-${config.id}`}>
          <strong>
            {role === 'Fallback' ? 'The fallback will not be used.' : 'AI is paused.'}
          </strong>{' '}
          {configName(config)}: {decision.allowed ? '' : TERMS_CONCERN_TEXT[decision.reason]}.
          People can still fill in everything themselves. Record its terms, or switch to a paid
          provider whose terms say it does not train on inputs.
        </div>
      ))}
      {warned.map(({ role, config, decision }) => (
        <div className="notice notice-warn u-mb-100" key={`warned-${config.id}`}>
          <strong>Real applicant data is on.</strong> {role} {configName(config)}:{' '}
          {decision.allowed && decision.warning ? TERMS_CONCERN_TEXT[decision.warning] : ''}. AI
          keeps running because the setting below is off. Before real documents reach it, switch to
          a paid provider that does not train on inputs and record its terms.
        </div>
      ))}
      <p className="card-body u-mb-100">
        When this is on, AI runs only on a provider recorded as not training on what it is sent,
        with the address of the terms that say so. When it is off, AI runs on the active provider
        whatever its terms, and this page warns you while real applicant data is on. Connection
        tests and evaluations use made-up text only and are never affected.
      </p>
      <DataRuleForm requireNoTraining={props.setting.requireNoTraining} />
    </article>
  );
}
