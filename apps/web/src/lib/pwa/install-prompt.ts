/**
 * Holds the browser's install offer (`beforeinstallprompt`, Chromium browsers only) so the Help
 * page can show an Install VisaStack button later. The event can fire on any page, before the
 * Help page exists, so the root runtime catches it and keeps it here. Safari and Firefox never
 * fire it; the Help page gives written steps there instead.
 */

/** The non-standard event Chromium fires when the site can be installed. */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed' }>;
}

let pending: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function setInstallPrompt(event: InstallPromptEvent | null): void {
  pending = event;
  notify();
}

export function getInstallPrompt(): InstallPromptEvent | null {
  return pending;
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Shows the browser's own install dialog. The offer can be used once, so it is cleared whatever
 * the person chooses; the browser offers it again later if they declined.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = pending;
  if (!event) return 'unavailable';
  setInstallPrompt(null);
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}
