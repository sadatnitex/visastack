/**
 * A small set of line icons, drawn here so the product needs no icon package and no
 * network request. Every icon is decorative: the words beside it carry the meaning, so
 * the drawing is hidden from screen readers. Stroke follows the text colour.
 */

const PATHS = {
  home: ['M3 11.5 12 4l9 7.5', 'M5.5 10v9.5h13V10', 'M10 19.5v-5h4v5'],
  users: [
    'M9 11a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z',
    'M3.5 19c.5-3.3 2.8-5 5.5-5s5 1.7 5.5 5',
    'M16 5.2a3 3 0 0 1 0 5.6',
    'M17.5 14.3c1.8.6 3 2.3 3.2 4.7',
  ],
  share: [
    'M17 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
    'M7 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
    'M17 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
    'm9.2 10.8 5.6-3.1',
    'm9.2 13.2 5.6 3.1',
  ],
  bell: ['M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.5h-15L6 16.5Z', 'M10 20.5a2.2 2.2 0 0 0 4 0'],
  shield: [
    'M12 3.5 5 6v5.5c0 4.3 2.8 7.4 7 9 4.2-1.6 7-4.7 7-9V6l-7-2.5Z',
    'm9 12 2.2 2.2L15.2 10',
  ],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4.5 20c.7-3.6 3.7-5.5 7.5-5.5s6.8 1.9 7.5 5.5'],
  building: ['M5 20.5V4.5h9v16', 'M14 9.5h5v11', 'M8 8h3M8 11.5h3M8 15h3', 'M3.5 20.5h17'],
  briefcase: ['M4 8h16v11H4Z', 'M9 8V5.5h6V8', 'M4 13h16'],
  file: ['M7 3.5h7l4 4v13H7Z', 'M14 3.5v4h4', 'M9.5 12.5H15M9.5 15.5H15'],
  clipboard: ['M8.5 5h7v2.5h-7Z', 'M7 6.5H5.5v14h13v-14H17', 'M9 12h6M9 15.5h4'],
  clock: ['M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17Z', 'M12 7.5V12l3 2'],
  check: ['m5 12.5 4.5 4.5L19 7.5'],
  alert: ['M12 4 3.5 19h17L12 4Z', 'M12 10v4M12 16.8v.2'],
  plus: ['M12 5v14M5 12h14'],
  search: ['M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z', 'm15.5 15.5 5 5'],
  arrow: ['M5 12h14m-5-5 5 5-5 5'],
  lock: ['M6 11h12v9H6Z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
  upload: ['M12 16V5m-4.5 4.5L12 5l4.5 4.5', 'M5 19h14'],
  calendar: ['M4.5 6.5h15v13h-15Z', 'M4.5 10.5h15M8.5 4v4M15.5 4v4'],
  settings: [
    'M5 7h8M17 7h2M5 17h2M11 17h8',
    'M15 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    'M9 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  ],
  logout: ['M10 4.5H5.5v15H10', 'm14 8 4 4-4 4M18 12H9'],
  chevron: ['m9 6 6 6-6 6'],
  folder: ['M3.5 6.5h6l2 2.5h9v10h-17Z'],
  mail: ['M4 6.5h16v11H4Z', 'm4.5 7 7.5 6 7.5-6'],
  eye: [
    'M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z',
    'M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  ],
  activity: ['M3 12h4l2.5-6 4 12 2.5-6H21'],
  key: ['M8 15a4 4 0 1 1 3.5-6H20v3h-2.5v2.5H15V12h-3.5A4 4 0 0 1 8 15Z'],
  more: ['M5 12h.01M12 12h.01M19 12h.01'],
  close: ['m6 6 12 12M18 6 6 18'],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 20,
}: {
  readonly name: IconName;
  readonly size?: number;
}) {
  return (
    <svg
      className="icon"
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
