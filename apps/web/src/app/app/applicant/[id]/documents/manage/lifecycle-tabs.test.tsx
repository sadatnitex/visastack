import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LifecycleTabs, lifecycleTabOf } from './lifecycle-tabs';

const html = (props: Partial<Parameters<typeof LifecycleTabs>[0]> = {}) =>
  renderToStaticMarkup(
    <LifecycleTabs
      basePath="/app/applicant/a1/documents"
      active="current"
      archivedCount={0}
      deletedCount={0}
      removalRecordsHref={null}
      {...props}
    />,
  );

describe('LifecycleTabs', () => {
  it('is hidden while Current would be alone', () => {
    expect(html()).toBe('');
  });
  it('adds a tab only for a list that has something in it, marking the open one', () => {
    const markup = html({ archivedCount: 2 });
    expect(markup).toContain('aria-label="Document lists"');
    const currentLink = markup.match(/<a [^>]*>Current<\/a>/)?.[0] ?? '';
    expect(currentLink).toContain('href="/app/applicant/a1/documents"');
    expect(currentLink).toContain('aria-current="page"');
    expect(markup.match(/aria-current/g)).toHaveLength(1);
    expect(markup).toContain('href="/app/applicant/a1/documents?view=archived"');
    expect(markup).toContain('Archived<span class="lc-tab-count"> (2)</span>');
    expect(markup).not.toContain('Recently Deleted');
  });
  it('keeps an open tab visible after its list empties, and shows the records link alone', () => {
    expect(html({ active: 'deleted' })).toContain('Recently Deleted');
    const records = html({ removalRecordsHref: '/app/applicant/a1/removal-records' });
    expect(records).toContain('Removal Records');
  });
  it('reads only known lists from the address', () => {
    expect(lifecycleTabOf('archived')).toBe('archived');
    expect(lifecycleTabOf('deleted')).toBe('deleted');
    expect(lifecycleTabOf('everything')).toBe('current');
    expect(lifecycleTabOf(['archived'])).toBe('current');
  });
});
