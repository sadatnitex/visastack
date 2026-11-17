// @vitest-environment jsdom
import { type ReactElement, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImportItem, ImportSnapshot } from '../lib/import/import-queue';
import { WaitingUploads, waitingKindOf, waitingSummary } from './waiting-uploads';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { root: Root; host: HTMLElement } | null = null;
function render(element: ReactElement) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
  act(() => root.render(element));
  return { container: host };
}
const screen = {
  getByText: (text: string) => {
    const hit = [...document.body.querySelectorAll('*')].find(
      (el) => el.children.length === 0 && el.textContent === text,
    );
    if (!hit) throw new Error(`no text ${text}`);
    return hit;
  },
  queryByText(text: string) {
    try {
      return screen.getByText(text);
    } catch {
      return null;
    }
  },
  getAllByRole: (_role: string) => [...document.body.querySelectorAll('button')],
  getByRole: (_role: string, o: { name: string }) => {
    const hit = [...document.body.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === o.name,
    );
    if (!hit) throw new Error(`no button ${o.name}`);
    return hit;
  },
  getByTestId: (id: string) => {
    const hit = document.body.querySelector(`[data-testid="${id}"]`);
    if (!hit) throw new Error(`no ${id}`);
    return hit;
  },
  queryByTestId: (id: string) => document.body.querySelector(`[data-testid="${id}"]`),
};
const fireEvent = {
  click: (el: Element) =>
    act(() => {
      (el as HTMLElement).click();
    }),
};

function item(id: number, state: ImportItem['state'], extra: Partial<ImportItem> = {}): ImportItem {
  return {
    id,
    name: `file-${id}.pdf`,
    path: '',
    size: 10,
    lastModified: 0,
    fingerprint: String(id),
    state,
    attempts: 0,
    progress: 0,
    message: '',
    title: null,
    removableCopyId: null,
    documentId: null,
    upgrade: null,
    skipReason: null,
    preparing: false,
    shrunkTo: null,
    busy: false,
    waitingToRetry: false,
    earlier: false,
    uploadId: `u${id}`,
    ...extra,
  };
}

function store(items: ImportItem[]) {
  let snap: ImportSnapshot = make(items);
  const listeners = new Set<() => void>();
  function make(list: ImportItem[]): ImportSnapshot {
    return {
      order: list.map((i) => i.id),
      byId: new Map(list.map((i) => [i.id, i])),
      paused: false,
      version: Math.random(),
    };
  }
  return {
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSnapshot: () => snap,
    set(list: ImportItem[]) {
      snap = make(list);
      for (const l of listeners) l();
    },
  };
}

afterEach(() => {
  if (mounted) {
    const m = mounted;
    act(() => m.root.unmount());
    m.host.remove();
    mounted = null;
  }
  vi.restoreAllMocks();
});

describe('waitingKindOf', () => {
  it('lists only files that have not reached the server', () => {
    expect(waitingKindOf({ state: 'queued' })).toBe('waiting');
    expect(waitingKindOf({ state: 'paused' })).toBe('waiting');
    expect(waitingKindOf({ state: 'held' })).toBe('waiting');
    expect(waitingKindOf({ state: 'uploading' })).toBe('sending');
    expect(waitingKindOf({ state: 'refused' })).toBe('trouble');
    expect(waitingKindOf({ state: 'unknown' })).toBe('trouble');
    for (const s of ['added', 'duplicate', 'unsupported', 'skipped'] as const) {
      expect(waitingKindOf({ state: s })).toBeNull();
    }
  });
});

describe('WaitingUploads', () => {
  it('draws nothing visible when no file is waiting', () => {
    const s = store([item(1, 'added'), item(2, 'duplicate')]);
    const { container } = render(<WaitingUploads source={s} onRetry={vi.fn()} />);
    expect(container.querySelector('.waiting-uploads')).toBeNull();
    expect(screen.queryByText('Waiting')).toBeNull();
  });

  it('shows a picture and a state word for each waiting file, never "Uploaded"', () => {
    const s = store([
      item(1, 'queued'),
      item(2, 'uploading'),
      item(3, 'refused'),
      item(4, 'added'),
    ]);
    const { container } = render(<WaitingUploads source={s} onRetry={vi.fn()} />);
    expect(container.querySelectorAll('.waiting-uploads-row')).toHaveLength(3);
    expect(container.querySelectorAll('.mark-tile')).toHaveLength(3);
    expect(screen.getByText('Waiting')).toBeTruthy();
    expect(screen.getByText('Sending')).toBeTruthy();
    expect(screen.getByText('Could Not Send')).toBeTruthy();
    expect(container.textContent).not.toMatch(/Uploaded|Received/);
  });

  it('wires Try Again to the queue retry, and only where a retry exists', () => {
    const onRetry = vi.fn();
    const s = store([item(1, 'queued'), item(2, 'refused'), item(3, 'unknown')]);
    render(<WaitingUploads source={s} onRetry={onRetry} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Try Again: file-2.pdf' }));
    expect(onRetry).toHaveBeenCalledWith(2);
  });

  it('says a file with no answer is not confirmed, not that it failed', () => {
    const s = store([item(1, 'unknown')]);
    render(<WaitingUploads source={s} onRetry={vi.fn()} />);
    expect(screen.getByText('Not Confirmed')).toBeTruthy();
    expect(screen.queryByText('Could Not Send')).toBeNull();
  });

  it('shows an Offline badge only while the browser reports offline, and follows the events', () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
    const s = store([item(1, 'queued')]);
    render(<WaitingUploads source={s} onRetry={vi.fn()} />);
    expect(screen.queryByTestId('waiting-offline')).toBeNull();
    online.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByTestId('waiting-offline').textContent).toContain('Offline');
    online.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByTestId('waiting-offline')).toBeNull();
  });

  it('announces only what needs the person, in one output element, never each file finishing', () => {
    const s = store([item(1, 'queued'), item(2, 'queued')]);
    render(<WaitingUploads source={s} onRetry={vi.fn()} />);
    const out = screen.getByTestId('waiting-announce');
    expect(out.tagName).toBe('OUTPUT');
    expect(out.textContent).toBe('');
    act(() => s.set([item(1, 'uploading', { progress: 10 }), item(2, 'queued')]));
    expect(out.textContent).toBe('');
    act(() => s.set([item(1, 'refused'), item(2, 'uploading')]));
    expect(out.textContent).toBe('');
    act(() => s.set([item(1, 'refused'), item(2, 'added')]));
    expect(out.textContent).toBe('1 Could Not Send.');
    act(() => s.set([item(1, 'added'), item(2, 'added')]));
    expect(out.textContent).toBe('');
  });

  it('calls a file held by the hourly limit Paused, not Waiting, and a photo being shrunk Waiting', () => {
    const s = store([item(1, 'held'), item(2, 'uploading', { preparing: true })]);
    render(<WaitingUploads source={s} onRetry={vi.fn()} />);
    expect(screen.getByText('Paused')).toBeTruthy();
    expect(screen.getByText('Waiting')).toBeTruthy();
    expect(screen.queryByText('Sending')).toBeNull();
  });

  it('draws six rows first and the rest on Show All', () => {
    const s = store(Array.from({ length: 20 }, (_, i) => item(i + 1, 'queued')));
    const { container } = render(<WaitingUploads source={s} onRetry={vi.fn()} />);
    expect(container.querySelectorAll('.waiting-uploads-row')).toHaveLength(6);
    const more = container.querySelector<HTMLButtonElement>('.waiting-uploads-more');
    expect(more?.textContent).toBe('Show All 20');
    fireEvent.click(more as Element);
    expect(container.querySelectorAll('.waiting-uploads-row')).toHaveLength(20);
  });
});

describe('waitingSummary', () => {
  it('counts only problems once nothing is waiting, and adds Offline', () => {
    expect(waitingSummary([{ state: 'held' }, { state: 'refused' }], true)).toBe(
      '1 Paused, 1 Could Not Send. Offline.',
    );
    expect(waitingSummary([{ state: 'queued' }, { state: 'uploading' }], false)).toBe('');
  });

  it('holds problems while any file still waits or sends, but still says Offline', () => {
    expect(waitingSummary([{ state: 'queued' }, { state: 'refused' }], false)).toBe('');
    expect(waitingSummary([{ state: 'uploading' }, { state: 'refused' }], true)).toBe('Offline.');
  });

  it('says nothing, not even Offline, with no file in the list', () => {
    expect(waitingSummary([], true)).toBe('');
    expect(waitingSummary([{ state: 'added' }], true)).toBe('');
  });
});

describe('a file waiting out a busy answer', () => {
  it('is Waiting, not Sending, while nothing is being sent', () => {
    expect(waitingKindOf({ state: 'uploading', waitingToRetry: true })).toBe('waiting');
    expect(waitingKindOf({ state: 'uploading', waitingToRetry: false })).toBe('sending');
    const s = store([item(1, 'uploading', { waitingToRetry: true })]);
    render(<WaitingUploads source={s} onRetry={vi.fn()} />);
    expect(screen.getByText('Waiting')).toBeTruthy();
    expect(screen.queryByText('Sending')).toBeNull();
  });

  it('does not announce Offline from an empty page', () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const s = store([item(1, 'added')]);
    render(<WaitingUploads source={s} onRetry={vi.fn()} />);
    expect(screen.getByTestId('waiting-announce').textContent).toBe('');
  });
});

describe('mount', () => {
  it('is on the import page, over the queue it already has, and the retry is the queue retry', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(process.cwd(), 'src/app/app/applicant/[id]/import/import-panel.tsx'),
      'utf8',
    );
    expect(src).toContain('<WaitingUploads source={queue} onRetry={(id) => queue.retry(id)} />');
  });
});

describe('WaitingUploads vibration', () => {
  const vibrate = vi.fn(() => true);
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'vibrate');
    vibrate.mockClear();
  });
  it('taps once when a sending file arrives, never for a refusal', () => {
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    const source = store([item(1, 'uploading'), item(2, 'uploading')]);
    render(<WaitingUploads source={source} onRetry={() => undefined} />);
    expect(vibrate).not.toHaveBeenCalled();
    act(() => source.set([item(1, 'added'), item(2, 'refused')]));
    expect(vibrate).toHaveBeenCalledTimes(1);
  });
});
