import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { textOf } from '../../lib/next-mocks.test-support';
import { type ProbeResult, StatusView } from './status-view';

const live: ProbeResult = { ok: true, status: 'live', data: { status: 'live' } };
const ready: ProbeResult = {
  ok: true,
  status: 'ready',
  data: {
    status: 'ready',
    deploymentMode: 'controlled_pilot',
    platform: {
      authentication: 'available',
      documentUpload: 'available',
      aiExtraction: 'unconfigured',
      malwareScanning: 'unconfigured',
      originalDownload: 'disabled',
      commercialClaims: 'disabled',
    },
  },
};

function render(props: Partial<Parameters<typeof StatusView>[0]> = {}) {
  return renderToStaticMarkup(
    <StatusView
      live={live}
      ready={ready}
      updatedAt="14:05:09"
      loading={false}
      onRefresh={() => undefined}
      {...props}
    />,
  );
}

describe('the status page', () => {
  it('opens with one plain verdict that is announced to screen readers', () => {
    const html = render();
    expect(textOf(html)).toContain('What Works Today');
    // <output> is the element whose changes a screen reader announces (a status region).
    expect(html).toContain(
      '<output class="badge badge-success status-verdict">Everything is working</output>',
    );
    // The answer comes before the list, the explanation and the refresh controls.
    expect(html.indexOf('Everything is working')).toBeLessThan(html.indexOf('You Can Use Now'));
    expect(html.indexOf('Everything is working')).toBeLessThan(html.indexOf('Check Now'));
  });

  it('lists each feature by name with what state it is in, and what is not switched on yet', () => {
    const text = textOf(render());
    expect(text).toContain('Signing In Working');
    expect(text).toContain('Uploading Documents Working');
    expect(text).toContain('AI Suggestions from Documents Not Set Up Yet');
    expect(text).toContain('Virus Scanning of Uploads Not Set Up Yet');
    expect(text).toContain('Downloading Original Files Switched Off for Now');
  });

  it('splits features into what can be used now and what is not switched on yet', () => {
    const html = render();
    const now = html.slice(html.indexOf('You Can Use Now'), html.indexOf('Not Switched On Yet'));
    const later = html.slice(html.indexOf('Not Switched On Yet'));
    expect(textOf(now)).toContain('Signing In');
    expect(textOf(now)).not.toContain('Virus scanning');
    expect(textOf(later)).toContain('Virus Scanning of Uploads');
    expect(textOf(later)).toContain('Downloading Original Files');
    expect(textOf(later)).not.toContain('Signing In');
  });

  it('never prints a raw key, a state code, a path or a tool name', () => {
    const text = textOf(render());
    for (const raw of [
      'aiExtraction',
      'malwareScanning',
      'unconfigured',
      'commercialClaims',
      '/api/',
      'Liveness',
      'Readiness',
      'controlled_pilot',
    ]) {
      expect(text, raw).not.toContain(raw);
    }
  });

  it('says some parts are having problems when the service is up but not ready', () => {
    const html = render({ ready: { ok: false, status: 'degraded', data: { status: 'degraded' } } });
    expect(textOf(html)).toContain('Some parts are having problems');
    expect(textOf(html)).toContain('The list of features is not available right now.');
  });

  it('says it cannot reach the service when nothing answers', () => {
    const down: ProbeResult = { ok: false, status: 'unreachable', data: {} };
    const html = render({ live: down, ready: down });
    expect(textOf(html)).toContain('We can’t reach the service right now');
    expect(html).toContain('badge badge-danger');
  });

  it('says checking before the first answers arrive, and when it last updated afterwards', () => {
    const waiting = render({ live: null, ready: null, updatedAt: '' });
    expect(textOf(waiting)).toContain('Checking…');
    expect(textOf(waiting)).toContain('Loading…');
    expect(textOf(render())).toContain('Updated 14:05:09. This page checks again by itself.');
  });

  it('shows the button as busy while a check is running, without taking focus away from it', () => {
    const html = render({ loading: true });
    expect(html).toMatch(/<button[^>]*aria-disabled="true"[^>]*>Checking…<\/button>/);
    // A `disabled` button cannot be focused, so a keyboard user resting on it would lose their
    // place every time the page re-checks by itself.
    expect(html).not.toMatch(/<button[^>]*\sdisabled/);
    expect(textOf(render())).toContain('Check Now');
    expect(render()).not.toContain('aria-disabled');
  });

  it('does not say the list is missing while the first answer is still on its way', () => {
    const waiting = textOf(render({ live: null, ready: null, updatedAt: '' }));
    expect(waiting).toContain('Checking which features are working…');
    expect(waiting).not.toContain('not available right now');
  });
});
