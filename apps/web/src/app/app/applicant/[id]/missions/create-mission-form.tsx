'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../../components/form-feedback';
import { Disclosure } from '../../../../../components/ui';
import { type ActionState, createMissionAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

export function CreateMissionForm({ applicantId }: { readonly applicantId: string }) {
  const [state, formAction, pending] = useActionState(createMissionAction, INITIAL);

  return (
    <form action={formAction} className="field-list">
      <input type="hidden" name="applicantId" value={applicantId} />
      <div className="field-row">
        <label className="field-label" htmlFor="title">
          What is this case for?
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          className="input"
          placeholder="e.g. UK Student Visa - Autumn 2026"
        />
      </div>
      <div className="field-row">
        <label className="field-label" htmlFor="destination">
          Where are you going?
        </label>
        <input
          id="destination"
          name="destination"
          type="text"
          className="input"
          placeholder="e.g. United Kingdom"
        />
      </div>
      <Disclosure
        title="Add more details (optional)"
        hint="Purpose, family trip label, dates and deadline"
      >
        <div className="field-row">
          <label className="field-label" htmlFor="purpose">
            Purpose (optional)
          </label>
          <input
            id="purpose"
            name="purpose"
            type="text"
            className="input"
            placeholder="e.g. Postgraduate study"
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="itineraryRef">
            Family trip label (optional)
          </label>
          <input
            id="itineraryRef"
            name="itineraryRef"
            type="text"
            className="input"
            placeholder="e.g. Smith Family Europe 2026"
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="jurisdiction">
            Jurisdiction / consular post (optional)
          </label>
          <input
            id="jurisdiction"
            name="jurisdiction"
            type="text"
            className="input"
            placeholder="e.g. US Embassy Dhaka"
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="serviceCategory">
            Service category (optional)
          </label>
          <input
            id="serviceCategory"
            name="serviceCategory"
            type="text"
            className="input"
            placeholder="e.g. Tourist, Student, Work"
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="travelStartDate">
            Travel dates (optional)
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              id="travelStartDate"
              name="travelStartDate"
              type="date"
              className="input"
              aria-label="Travel start date"
            />
            <input
              id="travelEndDate"
              name="travelEndDate"
              type="date"
              className="input"
              aria-label="Travel end date"
            />
          </div>
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="targetDeadline">
            Target deadline (optional)
          </label>
          <input id="targetDeadline" name="targetDeadline" type="date" className="input" />
        </div>
      </Disclosure>
      <div>
        <SubmitButton
          pending={pending}
          idle="Create case"
          busy="Creating…"
          className="btn btn-primary"
        />
        <FormMessage result={state} />
      </div>
    </form>
  );
}
