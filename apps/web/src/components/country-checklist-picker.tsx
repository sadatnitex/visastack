'use client';
import Link from 'next/link';
import { useId, useState } from 'react';
import { homeCatalog } from '../i18n/home';
import type { StartCountry, StartData, StartRoute } from '../lib/country-start';
import { startHrefForCountry } from '../lib/country-start-links';
import { CountryFlag } from './country-flag';
import { useT } from './i18n-provider';

/**
 * "Pick a country, see the checklist at once" (Growth G2). A person types or chooses a country and
 * the checklist for it fills in below, item by item, with no waiting: the data is already here.
 * It is a list of what is usually asked for, never a decision and never a promise, and a thin list
 * says so. Used on the public home page (then on to sign-up) and in the first-run country step
 * (then on to the permission screen); the words and the list are the same in both places.
 *
 * The country box is a plain text box with the browser's own list of names, so it works with a
 * keyboard, a screen reader and a phone's picker without any custom widget.
 */

function plain(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/** The country a typed name means. Whole names only, so a half-typed word never jumps to another country. */
function resolveCountry(text: string, countries: readonly StartCountry[]): StartCountry | null {
  const wanted = plain(text);
  if (wanted === '') return null;
  return (
    countries.find(
      (country) =>
        plain(country.name) === wanted || country.aka.some((other) => plain(other) === wanted),
    ) ?? null
  );
}

/** The conditions on an item, each as its own short line under it. */
function itemConditions(item: StartRoute['groups'][number]['items'][number]): string[] {
  const lines: string[] = [];
  if (item.onlyWhen) lines.push(`Only when: ${item.onlyWhen}`);
  if (item.maxAgeDays !== null) lines.push(`Must be dated within ${item.maxAgeDays} days.`);
  return lines;
}

export interface CountryChecklistPickerProps {
  readonly data: StartData;
  /** A country to start on, already checked against the data. */
  readonly initialIso2?: string | null;
  /** `home`: public page, ends in a link to create an account. `first-run`: ends in a form that confirms the choice. */
  readonly variant: 'home' | 'first-run';
  /** Home only: whether anyone can create an account today (otherwise the link leads to sign-in). */
  readonly signUpOpen?: boolean;
  /** First run only: the server action that records the choice and moves on. */
  readonly action?: (formData: FormData) => void | Promise<void>;
}

export function CountryChecklistPicker({
  data,
  initialIso2 = null,
  variant,
  signUpOpen = true,
  action,
}: CountryChecklistPickerProps) {
  const t = useT(homeCatalog);
  const ids = useId();
  const inputId = `${ids}-country`;
  const listId = `${ids}-names`;
  const hintId = `${ids}-hint`;
  const statusId = `${ids}-status`;
  const headingId = `${ids}-result`;
  const routeId = `${ids}-route`;

  const initial = data.countries.find((country) => country.iso2 === initialIso2) ?? null;
  const [text, setText] = useState(initial?.name ?? '');
  const [routeKey, setRouteKey] = useState<string | null>(null);
  // "No country matches" is said once the person leaves the box, not on every letter typed.
  const [leftBox, setLeftBox] = useState(false);

  const country = resolveCountry(text, data.countries);
  const routeKeys = country?.routeKeys ?? [];
  const activeKey = routeKey !== null && routeKeys.includes(routeKey) ? routeKey : routeKeys[0];
  const route = activeKey ? data.routes[activeKey] : undefined;
  const hasList = route !== undefined && route.total > 0;

  const Heading = variant === 'home' ? 'h3' : 'h2';
  const GroupHeading = variant === 'home' ? 'h4' : 'h3';

  let status = '';
  if (country) {
    status = hasList
      ? `Showing the checklist for ${country.name}: ${route?.total} items.`
      : `There is no checklist for ${country.name} yet.`;
  } else if (leftBox && text.trim() !== '') {
    status = 'No country matches. Pick one from the list.';
  }

  // Where each group starts in the whole list, so the reveal runs item by item across groups.
  const starts: number[] = [];
  let running = 0;
  for (const group of route?.groups ?? []) {
    starts.push(running);
    running += group.items.length;
  }
  return (
    <div className={`country-pick country-pick-${variant}`}>
      <div className="country-pick-field">
        <label htmlFor={inputId} className="country-pick-label">
          {t.node('home.countryChecklistPicker.whichCountryDoYouWantTo')}
        </label>
        <input
          id={inputId}
          className="input"
          type="text"
          list={listId}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setLeftBox(false);
            // A new country starts on its fullest list, never on the last country's visa type.
            setRouteKey(null);
          }}
          onBlur={() => setLeftBox(true)}
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          enterKeyHint="done"
          placeholder={t('home.countryChecklistPicker.forExampleJapan')}
          aria-describedby={`${hintId} ${statusId}`}
          {...t.lang('home.countryChecklistPicker.forExampleJapan')}
        />
        <datalist id={listId}>
          {data.countries.map((entry) => (
            <option key={entry.iso2} value={entry.name} />
          ))}
        </datalist>
        <p className="muted country-pick-hint" id={hintId}>
          {t.node('home.countryChecklistPicker.typeANameOrOpenThe', {
            withChecklist: data.withChecklist,
            length: data.countries.length,
          })}
        </p>
        <output className="country-pick-status" id={statusId}>
          {status}
        </output>
      </div>

      {country ? (
        <section className="country-pick-result" aria-labelledby={headingId}>
          <div className="country-pick-head">
            <CountryFlag iso2={country.iso2} name={country.name} size="md" decorative />
            <Heading className="country-pick-title" id={headingId}>
              {country.name}
            </Heading>
            <span className={country.researched ? 'badge' : 'badge badge-warning'}>
              {country.entry}
            </span>
          </div>
          <p className="muted">
            {t.node('home.countryChecklistPicker.forAnOrdinaryBangladeshiPassportThis')}
          </p>
          {routeKeys.length > 1 ? (
            <div className="country-pick-route">
              <label htmlFor={routeId}>{t.node('home.countryChecklistPicker.visaType')}</label>
              <select
                id={routeId}
                className="input"
                value={activeKey}
                onChange={(event) => setRouteKey(event.target.value)}
              >
                {routeKeys.map((key) => (
                  <option key={key} value={key}>
                    {data.routes[key]?.name ?? key}
                  </option>
                ))}
              </select>
            </div>
          ) : route ? (
            <p className="country-pick-route-name">{route.name}</p>
          ) : null}

          {hasList && route ? (
            <div className="country-pick-list" key={`${country.iso2}:${route.key}`}>
              {route.groups.map((group, groupAt) => (
                <div key={group.kind} className="country-pick-group">
                  <GroupHeading>{group.label}</GroupHeading>
                  <ul>
                    {group.items.map((item, itemAt) => {
                      const step = Math.min((starts[groupAt] ?? 0) + itemAt, 11);
                      const conditions = itemConditions(item);
                      return (
                        <li
                          key={`${itemAt}-${item.text}`}
                          className={`country-pick-item country-pick-step-${step}`}
                        >
                          <span className="country-pick-mark" aria-hidden="true" />
                          <span>
                            {item.text}
                            {item.optional ? (
                              <span className="muted">
                                {' '}
                                {t.node('home.countryChecklistPicker.optional')}
                              </span>
                            ) : null}
                            {item.check ? (
                              <span className="badge badge-warning">
                                {t.node('home.countryChecklistPicker.needsChecking')}
                              </span>
                            ) : null}
                            {conditions.map((line) => (
                              <span key={line} className="muted country-pick-note">
                                {line}
                              </span>
                            ))}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              {route.thin ? (
                <p className="muted">
                  {t.node('home.countryChecklistPicker.thisListMayNotBeComplete')}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="country-pick-none">
              {country.researched
                ? `We have not added a checklist for ${country.name} yet. That does not mean nothing is needed.`
                : `We have not collected the rules for ${country.name} yet. That does not mean no visa is needed.`}{' '}
              Check the official page.
            </p>
          )}

          {country.officialUrl ? (
            <p className="country-pick-official">
              <a href={country.officialUrl} target="_blank" rel="noopener noreferrer">
                {t.node('home.countryChecklistPicker.openTheOfficialPage')}
              </a>
            </p>
          ) : null}

          {variant === 'home' ? (
            <div className="country-pick-action">
              <Link
                className="btn btn-primary"
                href={startHrefForCountry(country.iso2, signUpOpen)}
              >
                {signUpOpen
                  ? t.node('home.countryChecklistPicker.createFreeAccountForName', {
                      name: country.name,
                    })
                  : t.node('home.countryChecklistPicker.signInToStartWithName', {
                      name: country.name,
                    })}
              </Link>
              <p className="muted">
                {t.node('home.countryChecklistPicker.weKeepYourCountryForThe')}
              </p>
            </div>
          ) : action ? (
            <form className="country-pick-action" action={action}>
              <input type="hidden" name="country" value={country.iso2} />
              <button type="submit" className="btn btn-primary">
                {t.node('home.countryChecklistPicker.continueWithName', { name: country.name })}
              </button>
            </form>
          ) : null}
        </section>
      ) : (
        <p className="country-pick-empty">
          {t.node('home.countryChecklistPicker.yourChecklistAppearsHereAsSoon')}
        </p>
      )}
    </div>
  );
}
