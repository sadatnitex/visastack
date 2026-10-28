import { AI_CONNECTION_COUNT_WINDOW_MS } from '@visastack/services';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { textOf } from '../../../../lib/next-mocks.test-support';
import { AiConnectionsCard } from './ai-connections-card';

const COUNTS = {
  available: true as const,
  active: 3,
  turnedOff: 1,
  served: 1250,
  denied: 0,
  since: new Date('2026-10-21T00:00:00Z'),
};

describe('AI App Connections card (S16)', () => {
  it('shows the four totals, including a zero as zero', () => {
    const text = textOf(renderToStaticMarkup(<AiConnectionsCard counts={COUNTS} enabled />));
    expect(text).toContain('AI App Connections');
    expect(text).toContain('Active Connections 3');
    expect(text).toContain('Connections Turned Off 1');
    expect(text).toContain('Requests Answered in the Last 7 Days 1,250');
    expect(text).toContain('Requests Refused in the Last 7 Days 0');
    expect(text).toContain('AI apps can connect on this site.');
  });

  it('says plainly when the connector is switched off', () => {
    const text = textOf(
      renderToStaticMarkup(<AiConnectionsCard counts={COUNTS} enabled={false} />),
    );
    expect(text).toContain('Switched off on this site: no AI app can connect.');
  });

  it('says "not available yet" before the connection tables exist, never a raw error', () => {
    const text = textOf(
      renderToStaticMarkup(<AiConnectionsCard counts={{ available: false }} enabled />),
    );
    expect(text).toContain('Not available yet.');
    expect(text).not.toContain('Active Connections');
    expect(text).not.toMatch(/relation|undefined|null|NaN/);
  });

  it('says the counts could not be read when the read failed, which is not "not yet"', () => {
    const text = textOf(renderToStaticMarkup(<AiConnectionsCard counts="unreadable" enabled />));
    expect(text).toContain('The counts could not be read right now.');
    expect(text).not.toContain('Not available yet.');
    expect(text).not.toContain('Active Connections');
  });

  it('names the window the service counts over', () => {
    const days = AI_CONNECTION_COUNT_WINDOW_MS / (24 * 60 * 60 * 1000);
    const text = textOf(renderToStaticMarkup(<AiConnectionsCard counts={COUNTS} enabled />));
    expect(text).toContain(`Requests Answered in the Last ${days} Days`);
  });

  it('never shows engineering words', () => {
    const text = textOf(renderToStaticMarkup(<AiConnectionsCard counts={COUNTS} enabled />));
    for (const word of ['MCP', 'OAuth', 'token', 'scope', 'audit', 'AI_CONNECTOR_ENABLED']) {
      expect(text, word).not.toContain(word);
    }
  });
});
