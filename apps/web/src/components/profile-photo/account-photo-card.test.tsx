// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderServer } from '../../lib/next-mocks.test-support';

vi.mock('server-only', () => ({}));
vi.mock('../../lib/locale', () => ({ getLocale: async () => 'en' }));

vi.mock('../../app/app/profile-photo-actions', () => ({
  saveProfilePhotoAction: vi.fn(),
  removeProfilePhotoAction: vi.fn(),
}));

const { AccountPhotoCard } = await import('./account-photo-card');

const SELF = '10000000-0000-4000-8000-000000000001';

async function mount(photo: Parameters<typeof AccountPhotoCard>[0]['photo']) {
  const host = document.createElement('div');
  host.innerHTML = await renderServer(<AccountPhotoCard photo={photo} />);
  return host;
}

describe('AccountPhotoCard', () => {
  it('manages the photo on the own profile of the signed-in person, with plain privacy wording', async () => {
    const host = await mount({
      self: { id: SELF, name: 'Rahima Akter', photoUrl: `/api/photos/applicant/${SELF}?v=1` },
    });
    expect(host.querySelector('h2')?.textContent).toBe('Your Photo');
    expect(host.textContent).toContain('Only you can see it');
    expect(host.textContent).toContain('never used as a visa photo');
    expect(host.querySelector('.profile-photo-card-avatar img')?.getAttribute('src')).toBe(
      `/api/photos/applicant/${SELF}?v=1`,
    );
    const names = [...host.querySelectorAll('button')].map((b) => b.textContent);
    expect(names).toEqual(['Replace Photo', 'Remove Photo']);
  });

  it('explains how to add a photo when the person has not added themselves yet', async () => {
    const host = await mount({ self: null });
    expect(host.querySelector('button')).toBeNull();
    const link = host.querySelector('a') as HTMLAnchorElement;
    expect(link.textContent).toBe('Add Yourself');
    expect(link.getAttribute('href')).toBe('/app/applicants');
  });
});
