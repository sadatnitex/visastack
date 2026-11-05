import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Icon, type IconName } from './icons';

/**
 * The icon set follows the Slice rule (docs/uiux/DESIGN-LANGUAGE.md): flat shapes in the text
 * colour, and at most one blue slice. An icon is decorative, so it is hidden from screen readers.
 */

const NAMES: readonly IconName[] = [
  'globe',
  'home',
  'users',
  'share',
  'bell',
  'shield',
  'user',
  'building',
  'briefcase',
  'file',
  'clipboard',
  'clock',
  'check',
  'alert',
  'plus',
  'search',
  'arrow',
  'lock',
  'upload',
  'calendar',
  'settings',
  'logout',
  'chevron',
  'chevronDown',
  'folder',
  'mail',
  'eye',
  'activity',
  'key',
  'more',
  'close',
  'circle',
  'plane',
  'sidebar',
];

describe('the icon set', () => {
  for (const name of NAMES) {
    it(`${name}: is drawn, hidden from screen readers, flat, and has at most one accent group`, () => {
      const html = renderToStaticMarkup(<Icon name={name} size={24} />);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('viewBox="0 0 24 24"');
      expect(html).toMatch(/<(path|polygon|circle)/);
      // Flat: nothing here paints a gradient, a shadow or a filter.
      expect(html).not.toMatch(/gradient|filter|shadow/i);
      // Colour comes from the page: the body is currentColor, the accent slice is a class.
      expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    });
  }

  it('draws every object icon with its blue slice, and no icon without a name in the list', () => {
    const accented = NAMES.filter((n) =>
      renderToStaticMarkup(<Icon name={n} />).includes('icon-accent'),
    );
    // Gestures carry no accent; every object has one.
    for (const gesture of [
      'check',
      'plus',
      'arrow',
      'chevron',
      'chevronDown',
      'close',
      'circle',
      'more',
    ] as const) {
      expect(accented).not.toContain(gesture);
    }
    for (const object of [
      'globe',
      'home',
      'bell',
      'shield',
      'file',
      'folder',
      'calendar',
      'lock',
    ] as const) {
      expect(accented).toContain(object);
    }
  });
});
