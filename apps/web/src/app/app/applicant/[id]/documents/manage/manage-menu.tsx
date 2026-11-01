'use client';
import type { DocumentAction } from '@visastack/services';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { MANAGE_ACTIONS, type ManageActionEntry, registeredActions } from './registry';

/**
 * The Manage menu of one document (WAI-ARIA menu button). Lists only the actions the lifecycle
 * rule allows (`availableDocumentActions`, decided on the server) that a lane has registered, so
 * it renders nothing at all until there is something to offer. Arrow keys, Home and End move
 * between items; Escape and Tab close it; focus returns to the button when the menu or an
 * opened action closes. Every target is at least 44 px.
 */
export function ManageMenu({
  applicantId,
  documentId,
  documentName,
  actions,
  initialAction,
  registry = MANAGE_ACTIONS,
}: {
  readonly applicantId: string;
  readonly documentId: string;
  readonly documentName: string;
  readonly actions: readonly DocumentAction[];
  /** From a reminder's link (?manage=<documentId>&action=<ACTION>): opens that action at once. */
  readonly initialAction?: DocumentAction;
  readonly registry?: Readonly<Partial<Record<DocumentAction, ManageActionEntry>>>;
}) {
  const items = registeredActions(actions, registry);
  const startAction =
    initialAction && items.some((item) => item.action === initialAction) ? initialAction : null;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<DocumentAction | null>(startAction);
  const button = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const panelId = useId();
  const focusIndex = useRef(0);

  useEffect(() => {
    if (open) itemRefs.current[focusIndex.current]?.focus();
  }, [open]);

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

  const chosen = active ? items.find((item) => item.action === active) : undefined;
  const Chosen = chosen?.entry.Component;

  return (
    <div className="lc-manage">
      <button
        ref={button}
        type="button"
        className="btn btn-secondary lc-manage-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Manage ${documentName}`}
        onClick={() => (open ? closeMenu(false) : openAt(0))}
        onKeyDown={onButtonKey}
      >
        Manage
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={`Manage ${documentName}`}
          className="lc-manage-menu"
        >
          {items.map((item, index) => (
            <button
              key={item.action}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="lc-manage-item"
              onKeyDown={(event) => onItemKey(event, index)}
              onClick={() => {
                setActive(item.action);
                setOpen(false);
              }}
            >
              {item.entry.label}
            </button>
          ))}
        </div>
      ) : null}
      {Chosen ? (
        <div id={panelId} className="lc-manage-panel">
          <Chosen
            applicantId={applicantId}
            documentId={documentId}
            documentName={documentName}
            onClose={() => {
              setActive(null);
              button.current?.focus();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
