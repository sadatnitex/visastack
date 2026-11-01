'use client';

import type { TravellerAction } from '@visastack/services';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { travellerLifecycleAction } from './actions';
import { TRAVELLER_ACTION_LABELS } from './labels';

type MenuAction = Extract<TravellerAction, 'ARCHIVE' | 'REMOVE_EMPTY'>;

const MENU_ACTIONS: readonly MenuAction[] = ['ARCHIVE', 'REMOVE_EMPTY'];

const COMMAND: Readonly<Record<MenuAction, string>> = {
  ARCHIVE: 'archive',
  REMOVE_EMPTY: 'remove',
};

function confirmation(action: MenuAction, name: string, days: number): string {
  return action === 'ARCHIVE'
    ? `${name} leaves your everyday lists and their reminders stop. Nothing is deleted, and you can restore them at any time from All Travellers.`
    : `This record holds no details, documents or cases. It moves to Recently Deleted and is removed for good after ${days} days. Until then you can restore it from All Travellers.`;
}

const BUSY: Readonly<Record<MenuAction, string>> = {
  ARCHIVE: 'Archiving\u2026',
  REMOVE_EMPTY: 'Removing\u2026',
};

function ConfirmButton({ action }: { readonly action: MenuAction }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary lc-traveller-button" disabled={pending}>
      {pending ? BUSY[action] : TRAVELLER_ACTION_LABELS[action]}
    </button>
  );
}

/**
 * The Manage menu on a traveller's own page (WAI-ARIA menu button, the same look as the document
 * Manage menu). It lists only what the server allowed (`availableTravellerActions`): Archive
 * Traveller and Remove Empty Record. Choosing one opens a short confirmation with a plain form, so
 * nothing happens on a single click. Arrow keys, Home and End move between items; Escape and Tab
 * close the menu; Cancel returns focus to the Manage button. Every target is at least 44 px.
 */
export function TravellerManageMenu({
  applicantId,
  name,
  actions,
  days,
}: {
  readonly applicantId: string;
  readonly name: string;
  readonly actions: readonly TravellerAction[];
  /** How long a removed record waits in Recently Deleted (TRAVELLER_RECENTLY_DELETED_DAYS). */
  readonly days: number;
}) {
  const items = MENU_ACTIONS.filter((action) => actions.includes(action));
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<MenuAction | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const panel = useRef<HTMLElement>(null);
  const focusIndex = useRef(0);
  const menuId = useId();
  const headingId = useId();

  useEffect(() => {
    if (open) itemRefs.current[focusIndex.current]?.focus();
  }, [open]);

  useEffect(() => {
    if (chosen) panel.current?.focus();
  }, [chosen]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && button.current?.parentElement?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (items.length === 0) return null;

  const openAt = (index: number) => {
    focusIndex.current = (index + items.length) % items.length;
    setOpen(true);
  };
  const closeMenu = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  };
  const move = (index: number) => {
    const next = (index + items.length) % items.length;
    focusIndex.current = next;
    itemRefs.current[next]?.focus();
  };
  const onButtonKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openAt(0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openAt(items.length - 1);
    }
  };
  const onItemKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      move(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      move(items.length - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === 'Tab') {
      closeMenu(false);
    }
  };

  return (
    <div className="lc-manage lc-traveller-manage">
      <button
        ref={button}
        type="button"
        className="btn btn-secondary lc-manage-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Manage ${name}`}
        onClick={() => (open ? closeMenu(false) : openAt(0))}
        onKeyDown={onButtonKey}
      >
        Manage
      </button>
      {open ? (
        <div id={menuId} role="menu" aria-label={`Manage ${name}`} className="lc-manage-menu">
          {items.map((action, index) => (
            <button
              key={action}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="lc-manage-item"
              onKeyDown={(event) => onItemKey(event, index)}
              onClick={() => {
                setChosen(action);
                setOpen(false);
              }}
            >
              {TRAVELLER_ACTION_LABELS[action]}
            </button>
          ))}
        </div>
      ) : null}
      {chosen ? (
        <section
          ref={panel}
          className="lc-manage-panel lc-traveller-confirm"
          tabIndex={-1}
          aria-labelledby={headingId}
        >
          <h3 id={headingId}>{TRAVELLER_ACTION_LABELS[chosen]}</h3>
          <p>{confirmation(chosen, name, days)}</p>
          <form action={travellerLifecycleAction} className="lc-traveller-actions">
            <input type="hidden" name="applicantId" value={applicantId} />
            <input type="hidden" name="command" value={COMMAND[chosen]} />
            <input type="hidden" name="returnTo" value="traveller" />
            <ConfirmButton action={chosen} />
            <button
              type="button"
              className="btn btn-secondary lc-traveller-button"
              onClick={() => {
                setChosen(null);
                button.current?.focus();
              }}
            >
              Cancel
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
