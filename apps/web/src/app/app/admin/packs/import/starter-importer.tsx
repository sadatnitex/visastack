'use client';

import { useActionState, useState, useTransition } from 'react';
import { FormMessage, SubmitButton } from '../../../../../components/form-feedback';
import { StatusBadge } from '../../../../../components/ui';
import type { ActionState } from '../actions';
import { NO_PREVIEW, type StarterPreviewState } from '../preview-state';
import { loadStarterListAction, previewStarterAction } from '../starter-actions';

const STATUS_WORDS = { new: 'New', changed: 'Changed', unchanged: 'Up to Date' } as const;
const STATUS_TONES = { new: 'success', changed: 'warning', unchanged: 'neutral' } as const;

type Progress = Readonly<Record<string, { readonly ok: boolean; readonly message: string }>>;

/**
 * Loads the starter country checklists into Pack Studio: the supplied lists, or a sheet saved as
 * CSV. It first shows what would change, then loads one list at a time so no single request runs
 * long and a failure names the list it stopped at. Nothing is loaded until the admin presses Load.
 */
export function StarterImporter({ suppliedCount }: { readonly suppliedCount: number }) {
  const [preview, previewAction, checking] = useActionState(previewStarterAction, NO_PREVIEW);
  const [source, setSource] = useState<'supplied' | 'sheet'>('supplied');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [progress, setProgress] = useState<Progress>({});
  const [running, startRunning] = useTransition();
  const [finished, setFinished] = useState('');

  // A result that holds no rows (a refusal, or nothing checked yet) shows the message alone.
  const rows = preview.rows ?? [];
  const skipped = preview.skipped ?? [];
  const pending = rows.filter((row) => row.status !== 'unchanged');

  const loadAll = () => {
    setFinished('');
    setProgress({});
    startRunning(async () => {
      let done = 0;
      for (const row of pending) {
        const form = new FormData();
        form.set('source', source);
        form.set('csv', csv);
        form.set('key', row.key);
        const result: ActionState = await loadStarterListAction({ ok: true, message: '' }, form);
        setProgress((now) => ({ ...now, [row.key]: result }));
        if (!result.ok) {
          setFinished(`Stopped at ${row.name}. ${result.message}`);
          return;
        }
        done += 1;
      }
      setFinished(`${done} ${done === 1 ? 'list' : 'lists'} loaded.`);
    });
  };

  return (
    <div className="field-list form-narrow">
      <form action={previewAction} className="field-list">
        <fieldset className="form-section">
          <legend>Where the Lists Come From</legend>
          <label className="field-row">
            <input
              type="radio"
              name="source"
              value="supplied"
              checked={source === 'supplied'}
              onChange={() => setSource('supplied')}
            />{' '}
            The supplied lists ({suppliedCount} lines)
          </label>
          <label className="field-row">
            <input
              type="radio"
              name="source"
              value="sheet"
              checked={source === 'sheet'}
              onChange={() => setSource('sheet')}
            />{' '}
            A Sheet Saved as CSV
          </label>
          {source === 'sheet' ? (
            <div className="field-row">
              <label className="field-label" htmlFor="starter-sheet">
                Sheet File
              </label>
              <input
                id="starter-sheet"
                type="file"
                accept=".csv,text/csv"
                className="input"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  setFileName(file?.name ?? '');
                  setCsv(file ? await file.text() : '');
                }}
              />
              {fileName ? <p className="muted">{fileName}</p> : null}
              <input type="hidden" name="csv" value={csv} />
            </div>
          ) : null}
        </fieldset>
        <SubmitButton
          pending={checking}
          idle="Check What Would Change"
          busy="Checking"
          className="btn btn-secondary"
        />
        <FormMessage result={preview} pending={checking} pendingText="Checking" />
      </form>

      {rows.length > 0 ? (
        <>
          <PreviewTable rows={rows} progress={progress} />
          {skipped.length > 0 ? (
            <details>
              <summary>Lines Left Out ({skipped.length})</summary>
              <ul>
                {skipped.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <button
            type="button"
            className="btn btn-primary"
            aria-disabled={running || pending.length === 0}
            onClick={() => {
              if (!running && pending.length > 0) loadAll();
            }}
          >
            {running
              ? 'Loading'
              : `Load ${pending.length} ${pending.length === 1 ? 'List' : 'Lists'}`}
          </button>
          <output className="muted" aria-live="polite">
            {finished}
          </output>
        </>
      ) : null}
    </div>
  );
}

function PreviewTable({
  rows,
  progress,
}: {
  readonly rows: StarterPreviewState['rows'];
  readonly progress: Progress;
}) {
  return (
    <div className="table-scroll">
      <table className="table">
        <caption className="sr-only">Starter lists and what loading would do</caption>
        <thead>
          <tr>
            <th scope="col">List</th>
            <th scope="col">Items</th>
            <th scope="col">Status</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.name}</th>
              <td>
                {row.requirementCount}
                {row.status === 'changed'
                  ? ` (+${row.added} / -${row.removed}${row.modified > 0 ? ` / ~${row.modified}` : ''})`
                  : ''}
              </td>
              <td>
                <StatusBadge tone={STATUS_TONES[row.status]}>
                  {STATUS_WORDS[row.status]}
                </StatusBadge>
              </td>
              <td>{progress[row.key]?.message ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
