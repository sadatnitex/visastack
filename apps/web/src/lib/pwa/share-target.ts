/**
 * Receiving files shared from another app (WP-PIC11, Phase 2 unit P2d): a photo or PDF shared
 * from WhatsApp or the gallery to the installed VisaStack app. Android Chromium and installed apps
 * only (verify at use); iPhone has no support, so nothing here shows there.
 *
 * The rule this file serves: a shared file never leaves the device until the person is signed in
 * and presses Add These Files on `/app/incoming`. The share arrives as a form post that the
 * service worker answers itself (`service-worker.ts`): it keeps the files in its own short-lived
 * inbox on the device, never stores a page, and sends the person on to `/app/incoming`, where the
 * normal sign-in check runs. From there each file goes through the same upload route, file checks
 * and safety scan as any other upload.
 *
 * Off by default. The owner turns it on with `WEB_SHARE_TARGET=on`; until then the app manifest has
 * no share entry, so the phone never offers VisaStack as a share destination.
 *
 * No Node or browser imports here: the manifest, the worker builder and the page all read it.
 */

/** Where the phone posts a share. Only the service worker reads what is posted here. */
export const SHARE_TARGET_PATH = '/share-target';

/** The page the person lands on after a share (signed-in only, under `/app`). */
export const INCOMING_PATH = '/app/incoming';

/** The form field the phone puts the shared files in. */
export const SHARE_FILES_FIELD = 'files';

/** The worker's own inbox on the device. Not a VisaStack static cache: it holds no public file. */
export const SHARE_INBOX_CACHE = 'visastack-share-inbox';

/** Served by the worker only, to `/app/incoming` only. No server route answers these. */
export const SHARE_FILE_PREFIX = `${SHARE_TARGET_PATH}/file/`;
export const SHARE_LIST_PATH = `${SHARE_TARGET_PATH}/list`;
export const SHARE_CLEAR_PATH = `${SHARE_TARGET_PATH}/clear`;

/**
 * The header the incoming page sends its account key in. The key never goes in an address, so it
 * cannot reach a server log even if no worker is there to answer. It is not a secret (the page gets
 * it as a prop): it only keeps one account's shared files apart from another's on the same device.
 */
export const SHARE_KEY_HEADER = 'x-visastack-share-key';

/**
 * The header a clear sends the share's own token in, so a page left open from an earlier share can
 * never empty a newer one. Kept out of the address for the same reason as the key.
 */
export const SHARE_TOKEN_HEADER = 'x-visastack-share-token';

/** The message a signing-out page posts to the worker: empty the inbox, whatever share it holds. */
export const SHARE_CLEAR_MESSAGE = 'CLEAR_SHARE_INBOX';

/** Most files one share keeps; the rest are counted and the page says so. */
export const SHARE_MAX_FILES = 10;

/** Largest single file the inbox keeps (larger photos are made smaller later, by the upload). */
export const SHARE_MAX_FILE_BYTES = 25 * 1024 * 1024;

/** How long shared files may wait on the device for the person to sign in and confirm. */
export const SHARE_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * The kinds of file VisaStack offers to receive: photos and PDFs. Each one is checked again by the
 * upload itself (a PDF needs the real scanner), so this list only decides what the phone offers.
 */
export const SHARE_ACCEPT: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'application/pdf',
];

/** Photos a browser can draw as a picture (HEIC is listed as a file, not drawn). */
export const SHARE_PICTURE_TYPES: readonly string[] = ['image/jpeg', 'image/png'];

/** The owner's switch. Anything but `on` (trimmed, any case) is off. */
export function isShareTargetSwitchOn(read: (name: string) => string | undefined): boolean {
  return read('WEB_SHARE_TARGET')?.trim().toLowerCase() === 'on';
}

/** The manifest's `share_target` entry, exactly as the phone reads it. */
export function shareTargetEntry() {
  return {
    action: SHARE_TARGET_PATH,
    method: 'POST' as const,
    enctype: 'multipart/form-data' as const,
    params: {
      files: [{ name: SHARE_FILES_FIELD, accept: [...SHARE_ACCEPT] }],
    },
  };
}

/** One file waiting in the inbox, as the worker lists it for `/app/incoming`. */
export interface SharedFile {
  /** Its place in the inbox, used in its address. */
  readonly n: number;
  readonly name: string;
  readonly type: string;
  readonly size: number;
}

/** What the worker answers on `SHARE_LIST_PATH`. */
export interface SharedInbox {
  readonly files: readonly SharedFile[];
  /** Files in the share that were not kept (too many, too large, or a kind we do not take). */
  readonly dropped: number;
  /** When the share arrived (ms), or 0 with nothing waiting. */
  readonly at: number;
  /**
   * A random value the worker makes for this one share once an account has opened it. Picture
   * addresses carry it instead of the account key; it means nothing outside this device and share.
   */
  readonly token: string;
}

export const EMPTY_INBOX: SharedInbox = { files: [], dropped: 0, at: 0, token: '' };

/** Reads the worker's answer defensively: anything unexpected is an empty inbox. */
export function parseInbox(value: unknown): SharedInbox {
  if (!value || typeof value !== 'object') return EMPTY_INBOX;
  const raw = value as { files?: unknown; dropped?: unknown; at?: unknown; token?: unknown };
  if (!Array.isArray(raw.files)) return EMPTY_INBOX;
  const files = raw.files
    .filter(
      (file): file is SharedFile =>
        !!file &&
        typeof file === 'object' &&
        Number.isInteger((file as SharedFile).n) &&
        typeof (file as SharedFile).name === 'string' &&
        typeof (file as SharedFile).type === 'string' &&
        SHARE_ACCEPT.includes((file as SharedFile).type) &&
        typeof (file as SharedFile).size === 'number',
    )
    .slice(0, SHARE_MAX_FILES);
  const dropped = Number.isInteger(raw.dropped) ? Math.max(0, raw.dropped as number) : 0;
  const at = typeof raw.at === 'number' && raw.at > 0 ? raw.at : 0;
  const token = typeof raw.token === 'string' && /^[0-9a-f]{32}$/.test(raw.token) ? raw.token : '';
  if (!token) return EMPTY_INBOX;
  return { files, dropped, at, token };
}

/** The address of one waiting file, carrying this share's token (never the account key). */
export function sharedFileUrl(n: number, token: string): string {
  return `${SHARE_FILE_PREFIX}${n}?t=${encodeURIComponent(token)}`;
}
