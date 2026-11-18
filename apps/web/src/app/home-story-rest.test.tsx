// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderServer } from '../lib/next-mocks.test-support';

vi.mock('../lib/public-beta', () => ({ isPublicBetaOpen: () => false }));
vi.mock('../lib/signed-in', () => ({ isSignedIn: async () => false }));

const { default: HomePage } = await import('./page');

/**
 * PUBFIX2 P2-7. Without script, on a phone and with reduced motion, a scene shows the step it was
 * written with. The approved reference starts the journey on its first stage (Getting Started, with
 * the You tag), so that is where the scene rests; before this fix it rested on Closed.
 */
describe('Home: where each scene rests (PUBFIX2 P2-7)', () => {
  it('rests the journey on its first stage, and keeps the other scenes on their finished step', async () => {
    const html = await renderServer(HomePage({ searchParams: Promise.resolve({}) }));
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const scene = (name: string) => doc.querySelector(`[data-scene="${name}"]`);
    const journey = scene('journey');
    expect(journey?.getAttribute('data-step')).toBe('0');
    expect(journey?.getAttribute('data-rest')).toBe('0');
    // The scenes that tell a finished story keep their last step.
    expect(scene('share')?.getAttribute('data-rest')).toBe('3');
    expect(scene('ready')?.getAttribute('data-rest')).toBe('2');
  });
});
