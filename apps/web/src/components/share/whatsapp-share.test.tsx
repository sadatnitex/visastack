// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../lib/axe.test-support';
import { type ShareMessage, composeShareMessage } from '../../lib/whatsapp-link';
import { CopyMessageOnly, WhatsAppShare } from './whatsapp-share';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const result = composeShareMessage(
  { template: 'summary-link', link: 'https://vs.example.test/app/shared' },
  { allowedOrigins: ['https://vs.example.test'] },
);
if (!result.ok) throw new Error('the fixture message was refused');
const message: ShareMessage = result.message;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'share');
  Reflect.deleteProperty(navigator, 'clipboard');
});

async function mount(element: React.ReactElement) {
  await act(async () => root.render(element));
}
function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((node) => node.textContent === label);
}
function sendLink(): HTMLAnchorElement {
  const link = container.querySelector<HTMLAnchorElement>('a.wa-share-send');
  if (!link) throw new Error('Missing Send on WhatsApp');
  return link;
}

describe('Send on WhatsApp (computer: no phone share sheet)', () => {
  it('offers Send on WhatsApp first and Copy Message, and no More Ways to Send', async () => {
    await mount(<WhatsAppShare message={message} />);
    const controls = [...container.querySelectorAll('a, button')].map((node) =>
      node.textContent?.replace(' (opens WhatsApp)', ''),
    );
    expect(controls).toEqual(['Send on WhatsApp', 'Copy Message']);
    expect(button('More Ways to Send')).toBeUndefined();
  });

  it("opens WhatsApp's own contact picker when no number is known, in a new tab, safely", async () => {
    await mount(<WhatsAppShare message={message} />);
    const link = sendLink();
    expect(link.href).toBe(`https://wa.me/?text=${encodeURIComponent(message.text)}`);
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
  });

  it("opens that person's chat when the screen already shows their number", async () => {
    await mount(<WhatsAppShare message={message} number="+880 1711-223344" />);
    expect(sendLink().href).toBe(
      `https://wa.me/8801711223344?text=${encodeURIComponent(message.text)}`,
    );
  });

  it('names its action for a screen reader and hides the decorative mark', async () => {
    await mount(<WhatsAppShare message={message} />);
    expect(sendLink().textContent).toBe('Send on WhatsApp (opens WhatsApp)');
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(await axeViolations(container.innerHTML)).toEqual([]);
  });

  it('can show only Send on WhatsApp for a short hello', async () => {
    await mount(<WhatsAppShare message={message} sendOnly />);
    expect(container.querySelectorAll('a, button')).toHaveLength(1);
  });

  it('puts extra buttons from the screen in the same row', async () => {
    await mount(
      <WhatsAppShare message={message}>
        <button type="button">Copy Link</button>
      </WhatsAppShare>,
    );
    expect(container.querySelector('.action-row')?.textContent).toContain('Copy Link');
  });
});

describe('More Ways to Send (phone with a share sheet)', () => {
  it('appears second, only where the browser can share, and shares the message', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    await mount(<WhatsAppShare message={message} title="VisaStack Help" />);
    const controls = [...container.querySelectorAll('a, button')].map((node) =>
      node.textContent?.replace(' (opens WhatsApp)', ''),
    );
    expect(controls).toEqual(['Send on WhatsApp', 'More Ways to Send', 'Copy Message']);
    await act(async () => button('More Ways to Send')?.click());
    expect(share).toHaveBeenCalledWith({ title: 'VisaStack Help', text: message.text });
  });

  it('says nothing when the person closes the share sheet', async () => {
    const closed = new DOMException('closed', 'AbortError');
    Object.defineProperty(navigator, 'share', {
      value: vi.fn().mockRejectedValue(closed),
      configurable: true,
    });
    await mount(<WhatsAppShare message={message} />);
    await act(async () => button('More Ways to Send')?.click());
    expect(container.querySelector('output')?.textContent).toBe('');
  });

  it('points back to Copy Message when sharing fails', async () => {
    Object.defineProperty(navigator, 'share', {
      value: vi.fn().mockRejectedValue(new Error('no')),
      configurable: true,
    });
    await mount(<WhatsAppShare message={message} />);
    await act(async () => button('More Ways to Send')?.click());
    expect(container.querySelector('output')?.textContent).toContain('You can still copy');
  });

  it('keeps Send on WhatsApp a plain link on a phone too', async () => {
    Object.defineProperty(navigator, 'share', { value: vi.fn(), configurable: true });
    await mount(<WhatsAppShare message={message} />);
    expect(sendLink().href.startsWith('https://wa.me/?text=')).toBe(true);
  });
});

describe('Copy Message', () => {
  it('copies the exact message and announces it politely', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await mount(<WhatsAppShare message={message} />);
    await act(async () => button('Copy Message')?.click());
    expect(writeText).toHaveBeenCalledWith(message.text);
    const status = container.querySelector('output');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent).toContain('Message copied');
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('shows the message selected when the clipboard is refused', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    await mount(<WhatsAppShare message={message} />);
    await act(async () => button('Copy Message')?.click());
    const field = container.querySelector('textarea');
    expect(field?.value).toBe(message.text);
    expect(field?.readOnly).toBe(true);
    expect(document.activeElement).toBe(field);
    expect(field?.selectionEnd).toBe(message.text.length);
    expect(container.querySelector('output')?.textContent).toContain('Copying is blocked');
    expect(container.querySelector('output')?.textContent).not.toContain('Message copied');
    expect(await axeViolations(container.innerHTML)).toEqual([]);
  });

  it('selects the message again on every blocked press, so the button never looks dead', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    await mount(<WhatsAppShare message={message} />);
    await act(async () => button('Copy Message')?.click());
    const field = container.querySelector('textarea');
    expect(document.activeElement).toBe(field);
    // The person clicks elsewhere, so the selection is lost, then presses again.
    await act(async () => {
      field?.setSelectionRange(0, 0);
      (document.activeElement as HTMLElement | null)?.blur();
    });
    expect(document.activeElement).not.toBe(field);
    await act(async () => button('Copy Message')?.click());
    expect(document.activeElement).toBe(container.querySelector('textarea'));
    expect(field?.selectionEnd).toBe(message.text.length);
  });

  it('can offer just Copy Message for text that cannot go to WhatsApp', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await mount(<CopyMessageOnly text="Plain words" />);
    expect(container.querySelector('a')).toBeNull();
    await act(async () => button('Copy Message')?.click());
    expect(writeText).toHaveBeenCalledWith('Plain words');
  });

  it('never says the message was sent', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    await mount(<WhatsAppShare message={message} />);
    await act(async () => button('Copy Message')?.click());
    expect(container.textContent?.toLowerCase()).not.toMatch(/\b(sent|delivered)\b/);
  });
});
