'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  type KeyboardEvent,
  type FocusEvent as ReactFocusEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Icon, type IconName } from '../../components/icons';
import { placePopover } from '../../lib/popover-placement';
import { useCloseOnOutsidePress } from '../../lib/use-popover';

export interface AccountMenuLink {
  readonly href: string;
  readonly label: string;
  readonly icon: IconName;
}

export interface AccountMenuGroup {
  readonly id: string;
  readonly label: string;
  readonly links: readonly AccountMenuLink[];
}

/**
 * The personal places every signed-in person can reach, in the order the menu shows them.
 * Workspace destinations (records, cases, agency tools) live in the sidebar, never here.
 */
export const ACCOUNT_MENU_GROUPS: readonly AccountMenuGroup[] = [
  {
    id: 'account',
    label: 'Account',
    links: [
      { href: '/app/account', label: 'Your Account', icon: 'user' },
      { href: '/app/applicants', label: 'Manage Travellers', icon: 'users' },
      { href: '/app/agency', label: 'Create or Manage an Agency', icon: 'building' },
      { href: '/app/privacy', label: 'Privacy & Consent', icon: 'shield' },
    ],
  },
  {
    id: 'support',
    label: 'Support',
    links: [
      // The same mark as the Help shortcut beside this menu, so the two read as one place.
      { href: '/app/help', label: 'Help & Support', icon: 'alert' },
      { href: '/status', label: 'Service Status', icon: 'activity' },
    ],
  },
];

/** Up to two letters, the same rule as the workspace selector, so a person reads the same everywhere. */
export function accountInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();
}

const stripSlash = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path);

/** Rows the arrow keys move between: every link and the Sign Out button, never the phone close button. */
const ROW_SELECTOR = 'a[href], .account-menu-signout button';

export function AccountMenu({
  name,
  email,
  photoUrl,
  plan,
  signOut,
}: {
  readonly name: string;
  /** The signed-in address, already held by the session; shown only when present. */
  readonly email?: string | undefined;
  /** Seam for a profile photo. Without one the avatar shows initials. */
  readonly photoUrl?: string | null | undefined;
  readonly plan?: { readonly name: string; readonly href: string } | null | undefined;
  /** The existing server action form; the menu only places and styles it. */
  readonly signOut: ReactNode;
}) {
  const pathname = usePathname();
  const account = useRef<HTMLDetailsElement>(null);
  const panel = useRef<HTMLElement>(null);
  const panelId = useId();
  const groupId = useId();
  const initials = accountInitials(name);
  const current = stripSlash(pathname.split(/[?#]/)[0] ?? pathname);

  const close = useCallback((returnFocus: boolean) => {
    const details = account.current;
    if (!details?.open) return;
    details.open = false;
    if (returnFocus) details.querySelector('summary')?.focus();
  }, []);

  // A new route closes the menu.
  // biome-ignore lint/correctness/useExhaustiveDependencies: route changes close transient controls
  useEffect(() => {
    if (account.current) account.current.open = false;
  }, [pathname]);

  // A tap or click anywhere else closes it, as the context chip and the More sheet do.
  useCloseOnOutsidePress(account);

  // Fit the panel to the screen: open it on the side of the trigger with room, no taller than that
  // room (taller content scrolls inside it), and never past a screen edge. The answer is written as
  // two data attributes and one custom property that the stylesheet reads; the phone sheet ignores it.
  const place = useCallback(() => {
    const details = account.current;
    const menu = panel.current;
    const trigger = details?.querySelector('summary');
    if (!details?.open || !menu || !trigger) return;
    const fit = placePopover({
      trigger: trigger.getBoundingClientRect(),
      viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
      contentHeight: menu.scrollHeight + (menu.offsetHeight - menu.clientHeight),
      width: menu.offsetWidth,
    });
    details.setAttribute('data-placement', fit.placement);
    details.setAttribute('data-align', fit.align);
    details.style.setProperty('--account-menu-max-height', `${fit.maxHeight}px`);
  }, []);

  const [shown, setShown] = useState(false);
  const onToggle = () => {
    const details = account.current;
    if (!details) return;
    setShown(details.open);
    if (details.open) {
      place();
      return;
    }
    details.removeAttribute('data-placement');
    details.removeAttribute('data-align');
    details.style.removeProperty('--account-menu-max-height');
  };

  // While open, a resized window or a scrolled page (or any scrolling area around the menu) changes
  // the room: measure again. Nothing is listened to while the menu is closed.
  useEffect(() => {
    if (!shown) return;
    let frame = 0;
    const again = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    window.addEventListener('resize', again);
    document.addEventListener('scroll', again, { passive: true, capture: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', again);
      document.removeEventListener('scroll', again, { capture: true });
    };
  }, [shown, place]);

  const rows = () => Array.from(panel.current?.querySelectorAll<HTMLElement>(ROW_SELECTOR) ?? []);

  const onKeyDown = (event: KeyboardEvent<HTMLDetailsElement>) => {
    const details = account.current;
    if (!details) return;
    if (event.key === 'Escape') {
      if (!details.open) return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const onTrigger = (event.target as HTMLElement).tagName === 'SUMMARY';
    if (onTrigger) {
      // Down or Up on the closed or open trigger opens the menu on its first or last row.
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      details.open = true;
      const list = rows();
      (event.key === 'ArrowDown' ? list[0] : list[list.length - 1])?.focus();
      return;
    }
    const list = rows();
    if (!list.length) return;
    const index = list.findIndex((row) => row === document.activeElement);
    const last = list.length - 1;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : event.key === 'ArrowDown'
            ? index < 0 || index === last
              ? 0
              : index + 1
            : index <= 0
              ? last
              : index - 1;
    event.preventDefault();
    list[next]?.focus();
  };

  // Tabbing past the last row (or Shift+Tab past the trigger) leaves naturally and closes the menu.
  const onBlur = (event: ReactFocusEvent<HTMLDetailsElement>) => {
    const to = event.relatedTarget;
    if (to instanceof Node && account.current && !account.current.contains(to)) close(false);
  };

  return (
    <details
      className="record-account"
      ref={account}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onToggle={onToggle}
    >
      <summary aria-label={`${name}, Account Menu`} aria-controls={panelId}>
        <b className="account-name-desktop" dir="auto">
          {name}
        </b>
        <b className="account-name-mobile" dir="auto">
          {name.trim().split(/\s+/)[0] || 'Account'}
        </b>
        {/* WP-X3: on the narrowest phones the account shows as an icon, leaving room for the context chip. */}
        <span className="account-icon-mobile" aria-hidden="true">
          <Icon name="user" size={20} />
        </span>
        <Icon name="chevronDown" size={14} />
      </summary>
      <nav
        id={panelId}
        className="account-menu-panel"
        ref={panel}
        aria-label="Account Menu"
        onClickCapture={(event) => {
          if ((event.target as HTMLElement).closest('a')) close(false);
        }}
      >
        <div className="account-menu-header">
          <span className="workspace-avatar account-menu-avatar" aria-hidden="true">
            {photoUrl ? <img src={photoUrl} alt="" /> : initials || <Icon name="user" size={20} />}
          </span>
          <div className="account-menu-who">
            <p className="account-menu-name" dir="auto">
              {name}
            </p>
            {email ? (
              <p className="account-menu-email" dir="auto">
                {email}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="account-menu-close"
            aria-label="Close Account Menu"
            onClick={() => close(true)}
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="account-menu-plan">
          {plan ? (
            <p className="account-menu-plan-name">
              <span className="sr-only">Your plan: </span>
              <span className="account-menu-chip">{plan.name}</span>
            </p>
          ) : null}
          <Link className="account-menu-plan-link" href={plan?.href ?? '/app/account'}>
            View Plan
            <Icon name="chevron" size={16} />
          </Link>
        </div>
        {/* Plain rows, not list items: the product underlines links inside lists and sentences. */}
        {ACCOUNT_MENU_GROUPS.map((group) => (
          <div className="account-menu-group" key={group.id}>
            <p className="account-menu-label" id={`${groupId}-${group.id}`}>
              {group.label}
            </p>
            <div
              className="account-menu-list"
              // biome-ignore lint/a11y/useSemanticElements: a fieldset groups form controls; these are links
              role="group"
              aria-labelledby={`${groupId}-${group.id}`}
            >
              {group.links.map((link) => (
                <Link
                  key={link.href}
                  className="account-menu-row"
                  href={link.href}
                  aria-current={current === link.href ? 'page' : undefined}
                >
                  <Icon name={link.icon} size={20} />
                  <span>{link.label}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
        <div className="account-menu-signout">{signOut}</div>
      </nav>
    </details>
  );
}
