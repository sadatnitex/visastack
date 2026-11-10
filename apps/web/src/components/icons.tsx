/**
 * The VisaStack icon set, drawn here so the product needs no icon package and no network
 * request. Every icon is decorative: the words beside it carry the meaning, so the drawing is
 * hidden from screen readers.
 *
 * The drawing rule comes from the brand mark, the Sliced V: one shape cut into stacked slices,
 * because a record is built in layers. An object is built from the same flat slices, 3 units tall
 * with 1.5 between them, with rounded corners; one slice in each icon is the accent and takes the
 * brand blue. The body follows the text colour. A globe is a sliced circle, a bell is slices that
 * widen, a shield is slices that narrow. Controls that are only a gesture (a tick, a cross, an
 * arrow, a chevron) stay a plain stroke with round ends, so they never compete with an object.
 */

type Fill = {
  readonly kind: 'fill';
  readonly points: string;
  readonly accent?: boolean;
};
type Dot = {
  readonly kind: 'dot';
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly accent?: boolean;
};
type Line = {
  readonly kind: 'line';
  readonly d: string;
  readonly width?: number;
  readonly accent?: boolean;
};
type Shape = Fill | Dot | Line;

/** Rounded corners come from a 1.2 wide round-joined stroke, so the polygon is drawn 0.6 inside the slice. */
const INSET = 0.6;
const SLANT = 2.4;

interface BarOptions {
  /** The height of the slice. Three, unless a detail needs less. */
  readonly h?: number;
  /** A slanted end: the slice leans like the arms of the V. */
  readonly cut?: 'l' | 'r' | 'lr';
  /** Taper the slice so its lower edge is shorter, like one layer of the V. */
  readonly taper?: boolean;
  readonly accent?: boolean;
}

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** One slice: x and y are the slice's own outer corner, w and h its outer size. */
function bar(x: number, y: number, w: number, options: BarOptions = {}): Fill {
  const h = options.h ?? 3;
  const left = x + INSET;
  const right = x + w - INSET;
  const top = y + INSET;
  const bottom = y + h - INSET;
  const lean = SLANT * (h / 3);
  const cutLeft = options.cut === 'l' || options.cut === 'lr';
  const cutRight = options.cut === 'r' || options.cut === 'lr';
  const pull = options.taper ? lean : 0;
  const pts: ReadonlyArray<readonly [number, number]> = [
    [left + (cutLeft ? lean : 0), top],
    [right - (cutRight ? lean : 0), top],
    [right - pull, bottom],
    [left + pull, bottom],
  ];
  return {
    kind: 'fill',
    points: pts.map(([px, py]) => `${fmt(px)},${fmt(py)}`).join(' '),
    ...(options.accent ? { accent: true } : {}),
  };
}

const dot = (x: number, y: number, r: number, accent = false): Dot => ({
  kind: 'dot',
  x,
  y,
  r,
  ...(accent ? { accent: true } : {}),
});
const line = (d: string, width = 2, accent = false): Line => ({
  kind: 'line',
  d,
  width,
  ...(accent ? { accent: true } : {}),
});

const PATHS = {
  globe: [
    line('M12 3.6a8.4 8.4 0 1 0 0 16.8 8.4 8.4 0 0 0 0-16.8Z', 1.9),
    line(
      'M12 3.6c2.3 2.3 3.4 5.1 3.4 8.4s-1.1 6.1-3.4 8.4c-2.3-2.3-3.4-5.1-3.4-8.4S9.7 5.9 12 3.6Z',
      1.9,
    ),
    bar(3, 10.7, 18, { h: 2.6, cut: 'lr', accent: true }),
  ],
  home: [
    line('M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10', 1.9),
    bar(8.5, 13.2, 7, { h: 2.6, accent: true }),
  ],
  users: [
    line('M9 11.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z', 1.9),
    line('M3.4 19.4c.5-3.2 2.7-4.9 5.6-4.9s5.1 1.7 5.6 4.9', 1.9),
    line('M16.4 5.4a3 3 0 0 1 0 5.6M17.6 14.6c1.7.6 2.8 2.2 3 4.8', 1.9, true),
  ],
  share: [
    dot(6, 12, 2.6),
    dot(18, 6, 2.6, true),
    dot(18, 18, 2.6),
    line('m8.3 10.8 7.4-3.6M8.3 13.2l7.4 3.6', 1.8),
  ],
  bell: [
    line('M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.5h-15L6 16.5Z', 1.9),
    bar(9.2, 20, 5.6, { h: 2.4, accent: true }),
  ],
  shield: [
    line('M12 3.5 5 6v5.5c0 4.3 2.8 7.4 7 9 4.2-1.6 7-4.7 7-9V6l-7-2.5Z', 1.9),
    bar(8, 10.7, 8, { h: 2.6, cut: 'lr', accent: true }),
  ],
  user: [
    line('M12 11.6a3.8 3.8 0 1 0 0-7.6 3.8 3.8 0 0 0 0 7.6Z', 1.9),
    line('M4.6 20c.7-3.6 3.6-5.4 7.4-5.4s6.7 1.8 7.4 5.4', 1.9, true),
  ],
  building: [
    line('M5 20.5V4.5h9v16M14 9.5h5v11M3.5 20.5h17', 1.9),
    bar(7.6, 8, 3.8, { h: 2.2, accent: true }),
    bar(7.6, 12.2, 3.8, { h: 2.2 }),
  ],
  briefcase: [line('M4 8h16v11H4ZM9 8V5.5h6V8', 1.9), bar(3.5, 12, 17, { h: 2.6, accent: true })],
  // A page: two slices of text, the first in blue.
  file: [
    line('M7 3.5h7l4 4v13H7Z M14 3.5v4h4', 1.9),
    bar(9.6, 11.2, 6, { h: 2.4, cut: 'r', accent: true }),
    bar(9.6, 15.2, 6, { h: 2.4 }),
  ],
  clipboard: [
    line('M8.5 5h7v2.5h-7ZM7 6.5H5.5v14h13v-14H17', 1.9),
    bar(9, 11.2, 6, { h: 2.4, cut: 'r', accent: true }),
    bar(9, 15.2, 6, { h: 2.4 }),
  ],
  clock: [
    line('M12 3.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4Z', 1.9),
    line('M12 7.6V12l3.2 2', 2, true),
  ],
  check: [line('m5 12.5 4.5 4.5L19 7.5', 2.4)],
  alert: [
    line('M12 4 3.5 19h17L12 4Z', 1.9),
    line('M12 10v3.6', 2.2, true),
    dot(12, 16.6, 1.2, true),
  ],
  plus: [line('M12 5v14M5 12h14', 2.2)],
  search: [
    line('M10.5 4.4a6.1 6.1 0 1 0 0 12.2 6.1 6.1 0 0 0 0-12.2Z', 1.9),
    line('m15.2 15.2 4.8 4.8', 2.6, true),
  ],
  arrow: [line('M5 12h14m-5-5 5 5-5 5', 2)],
  lock: [
    line('M8.2 10.4V8a3.8 3.8 0 0 1 7.6 0v2.4M5.5 10.4h13v9.6h-13Z', 1.9),
    bar(10, 13.6, 4, { h: 2.6, accent: true }),
  ],
  upload: [
    line('M12 15.5V4.5m-4.5 4.5L12 4.5 16.5 9', 2),
    bar(4, 18.4, 16, { h: 2.6, cut: 'lr', accent: true }),
  ],
  calendar: [
    line('M4.5 6.5h15v13h-15ZM8.5 4v4M15.5 4v4', 1.9),
    bar(4.5, 10.2, 15, { h: 2.6, accent: true }),
  ],
  // Three tracks and their stops.
  settings: [line('M4 7h8M18 7h2M4 17h2M12 17h8', 1.9), dot(15, 7, 2.6, true), dot(9, 17, 2.6)],
  logout: [line('M10 4.5H5.5v15H10', 1.9), line('m14 8 4 4-4 4M18 12H9', 2, true)],
  chevron: [line('m9 6 6 6-6 6', 2.2)],
  chevronDown: [line('m6 9 6 6 6-6', 2.2)],
  folder: [
    line('M3.5 6.5h6l2 2.5h9v10h-17Z', 1.9),
    bar(7, 13.2, 10, { h: 2.4, cut: 'lr', accent: true }),
  ],
  mail: [line('M4 6.5h16v11H4Z', 1.9), line('m4.6 7.2 7.4 5.8 7.4-5.8', 1.9, true)],
  // The pupil is the accent between two lids.
  eye: [
    line('M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z', 1.9),
    dot(12, 12, 2.7, true),
  ],
  activity: [line('M3 12h4l2.5-6 4 12 2.5-6H21', 2, true)],
  key: [
    line('M8.5 7.8a4.2 4.2 0 1 0 0 8.4 4.2 4.2 0 0 0 0-8.4Z', 1.9),
    bar(12.6, 10.7, 8.4, { h: 2.6, cut: 'r', accent: true }),
    bar(17.6, 13, 3.4, { h: 2.6 }),
  ],
  more: [dot(5, 12, 1.7), dot(12, 12, 1.7), dot(19, 12, 1.7)],
  close: [line('m6 6 12 12M18 6 6 18', 2.2)],
  // An empty ring: an item with nothing done on it yet.
  circle: [line('M12 3.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4Z', 1.9)],
  // An aeroplane seen from above: a trip.
  plane: [
    line(
      'M12 3.5c.8 0 1.5.8 1.5 2V10l7 4.5v2l-7-2V18l2 1.5V21L12 20l-3.5 1v-1.5l2-1.5v-3.5l-7 2v-2l7-4.5V5.5c0-1.2.7-2 1.5-2Z',
      1.8,
    ),
    bar(9.8, 9.4, 4.4, { h: 2.4, accent: true }),
  ],
  // A page with its side panel marked: the show and hide control for the sidebar.
  sidebar: [line('M4 5.5h16v13H4Z', 1.9), line('M9.5 5.5v13', 1.9, true)],

  // ---- Document kinds. One silhouette each, so a paper is told apart at 20px without reading. ----
  // A passport booklet: the cover seal and the machine-readable strip.
  docPassport: [
    line('M5.5 3.5h13v17h-13Z', 1.9),
    line('M13 6.8a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4Z', 1.6),
    bar(9, 15.4, 7.5, { h: 2.4, accent: true }),
  ],
  // A national ID card: the portrait and two lines of detail.
  docId: [
    line('M3 6.5h18v11H3Z', 1.9),
    dot(8, 11, 1.9, true),
    line('M5.2 15.2c.5-1.4 1.6-2 2.8-2s2.3.6 2.8 2', 1.7),
    bar(13, 9.9, 5.5, { h: 2.2, accent: true }),
    bar(13, 13.4, 4, { h: 2.2 }),
  ],
  // A passport photo: a head and shoulders in a frame.
  docPhoto: [
    line('M5 3.5h14v17H5Z', 1.9),
    dot(12, 9.6, 2.8),
    line('M7.6 17.6c.6-2.6 2.2-3.8 4.4-3.8s3.8 1.2 4.4 3.8', 1.9, true),
  ],
  // A bank: the roof, the columns and the step. A bank statement, and anything a bank issues.
  docBank: [
    line('M3.5 9.4 12 4.2l8.5 5.2', 1.9),
    line('M6.5 11.8v5.4M10 11.8v5.4M14 11.8v5.4M17.5 11.8v5.4', 1.9),
    bar(3.5, 18.6, 17, { h: 2.4, accent: true }),
  ],
  // A banknote: pay, income, salary.
  docSalary: [
    line('M3 7h18v10H3Z', 1.9),
    line('M12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Z', 1.7, true),
    dot(6.2, 12, 1),
    dot(17.8, 12, 1),
  ],
  // A page with a percent sign: tax.
  docTax: [
    line('M6 3.5h12v17H6Z', 1.9),
    dot(9.8, 9.6, 1.3),
    dot(14.2, 15.2, 1.3),
    line('m14.4 8.8-4.8 7.2', 1.9, true),
  ],
  // A shopfront: a trade licence, a business registration.
  docLicence: [
    line('M4.5 10v9.5h15V10M10 19.5v-4.5h4v4.5', 1.9),
    line('M3.5 10 5 4.5h14l1.5 5.5', 1.9),
    bar(3.5, 10, 17, { h: 2.4, accent: true }),
  ],
  // A sheet with a seal and its two ribbon tails: a certificate.
  docCertificate: [
    line('M4.5 4.5h15v11h-15Z', 1.9),
    bar(7.4, 7.4, 9, { h: 2.2 }),
    bar(7.4, 10.8, 5, { h: 2.2 }),
    dot(16.4, 16.4, 2.5, true),
    line('m15.2 18.4-.8 3 2-.9 2 .9-.8-3', 1.5),
  ],
  // A letter: lines of text above a signature stroke.
  docLetter: [
    line('M6 3.5h12v17H6Z', 1.9),
    bar(8.6, 6.4, 6.8, { h: 2 }),
    bar(8.6, 9.8, 6.8, { h: 2 }),
    line('M8.8 17c1.1-2 2.1-2 2.9-.6.7 1.2 1.6 1 2.6-.4', 1.7, true),
  ],
  // A boarding pass: the stub is torn off along the dotted line.
  docFlight: [
    line('M3.5 7h17v10h-17Z', 1.9),
    line('M15.5 7.6v1.5M15.5 11.3v1.5M15.5 15v1.4', 1.5),
    bar(6, 10, 6.5, { h: 2.2, accent: true }),
    bar(6, 13.4, 4.5, { h: 2.2 }),
  ],
  // A bed: a hotel, a place to stay.
  docHotel: [
    line('M3.5 6.5v13M3.5 15.5h17v4M11 15.5V11h7a2.5 2.5 0 0 1 2.5 2.5v2', 1.9),
    dot(7.4, 12, 1.9, true),
  ],
  // An umbrella: cover for the trip.
  docInsurance: [
    line('M3.5 12.5a8.5 8.5 0 0 1 17 0Z', 1.9),
    line('M12 12.5V18a2 2 0 0 1-4 0M12 3.5v1', 1.9, true),
  ],

  // ---- What a trip is for. ----
  // A map pin: a holiday.
  tripTourist: [
    line('M12 21s-6-5.6-6-10.5a6 6 0 1 1 12 0C18 15.4 12 21 12 21Z', 1.9),
    dot(12, 10.3, 2.3, true),
  ],
  // A mortarboard: study.
  tripStudy: [
    line('M12 5 2.8 9.5 12 14l9.2-4.5Z', 1.9),
    line('M6.6 12.3v4c0 1.4 2.4 2.7 5.4 2.7s5.4-1.3 5.4-2.7v-4', 1.9),
    line('M21.2 9.5v5', 1.9, true),
  ],
  // A hard hat: a job.
  tripWork: [
    line('M5 15.5a7 7 0 0 1 14 0M12 8.5v7', 1.9),
    bar(3, 15.5, 18, { h: 2.6, accent: true }),
  ],
  // A first-aid case: treatment.
  tripMedical: [line('M4 8h16v12H4ZM9 8V5.5h6V8', 1.9), line('M12 11.2v5.6M9.2 14h5.6', 2, true)],
  // Two adults and a child: family.
  tripFamily: [
    dot(6.2, 6.6, 2.2),
    line('M2.6 14.4c.4-2.4 1.5-3.4 3.6-3.4s3.2 1 3.6 3.4', 1.8),
    dot(17.8, 6.6, 2.2),
    line('M14.2 14.4c.4-2.4 1.5-3.4 3.6-3.4s3.2 1 3.6 3.4', 1.8),
    dot(12, 14.2, 1.8, true),
    line('M9 20.5c.3-2.2 1.3-3 3-3s2.7.8 3 3', 1.8, true),
  ],
  // A domed building: a pilgrimage, Hajj or Umrah.
  tripPilgrim: [
    line('M6.4 12a5.6 5.6 0 0 1 11.2 0M12 3.6v2.8', 1.9),
    line('M5 12h14v8.5H5ZM10.4 20.5v-3.4a1.6 1.6 0 0 1 3.2 0v3.4', 1.9),
    bar(5, 12, 14, { h: 2.2, accent: true }),
  ],
  // Arrive, pass through the gate, go on: a stop on the way.
  tripTransit: [
    dot(5, 12, 2.2),
    line('M8.2 12h8.3m-3.4-3.4 3.4 3.4-3.4 3.4', 2),
    line('M20 6.5v11', 2.4, true),
  ],

  // ---- Where a thing stands. ----
  // A ring with a tick: done.
  stateDone: [
    line('M12 3.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4Z', 1.9),
    line('m8 12.3 2.8 2.8 5.4-5.6', 2.1, true),
  ],
  // A ring with a mark: this one needs you.
  stateNeedsYou: [
    line('M12 3.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4Z', 1.9),
    line('M12 7.6v5.2', 2.2, true),
    dot(12, 16.2, 1.2, true),
  ],
  // A lens with a tick inside: someone has to check it.
  stateCheck: [
    line('M10.5 4.4a6.1 6.1 0 1 0 0 12.2 6.1 6.1 0 0 0 0-12.2Z', 1.9),
    line('m15.2 15.2 4.8 4.8', 2.4),
    line('m7.9 10.6 1.9 1.9 3.2-3.4', 1.9, true),
  ],
  // An hourglass: waiting on someone.
  stateWaiting: [
    line(
      'M7 3.8h10M7 20.2h10M8 3.8v3.2c0 1.7 1.3 3.1 2.7 4L12 12l1.3-1c1.4-.9 2.7-2.3 2.7-4V3.8',
      1.9,
    ),
    line('M8 20.2v-3.2c0-1.7 1.3-3.1 2.7-4L12 12l1.3 1c1.4.9 2.7 2.3 2.7 4v3.2', 1.9),
    bar(9.4, 17.4, 5.2, { h: 2.2, accent: true }),
  ],
  // A tray with an arrow into it: sent, received, in the post.
  stateReceived: [
    line('M4 13.5V19h16v-5.5h-5l-1 2h-4l-1-2Z', 1.9),
    line('M12 4v8m-3.2-3.2L12 12l3.2-3.2', 2, true),
  ],

  // ---- Things to do. ----
  camera: [
    line('M3.5 7.5h4l1.5-2.5h6l1.5 2.5h4v12h-17Z', 1.9),
    line('M12 10.2a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Z', 1.8, true),
  ],
  // A speech bubble with a question: ask for something.
  ask: [
    line('M4 5h16v11H11l-4 3.5V16H4Z', 1.9),
    line('M10.3 8.9a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.9.8-.9 1.4', 1.8, true),
    dot(12, 13.9, 0.9, true),
  ],
  // A ring with two bars: paused.
  pause: [
    line('M12 3.8a8.2 8.2 0 1 0 0 16.4 8.2 8.2 0 0 0 0-16.4Z', 1.9),
    line('M10 9v6M14 9v6', 2.2, true),
  ],
} as const satisfies Record<string, readonly Shape[]>;

export type IconName = keyof typeof PATHS;

/** Every icon name, for tests and legends. */
export const ICON_NAMES = Object.keys(PATHS) as readonly IconName[];

/** An icon's drawing as text, so a test can tell two names that draw the same picture. */
export function iconDrawing(name: IconName): string {
  return JSON.stringify(PATHS[name]);
}

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
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {(PATHS[name] as readonly Shape[]).map((shape) => {
        const accent = shape.accent ? 'icon-accent' : undefined;
        if (shape.kind === 'dot') {
          return (
            <circle
              key={`d${shape.x},${shape.y},${shape.r}`}
              className={accent}
              cx={shape.x}
              cy={shape.y}
              r={shape.r}
              fill="currentColor"
            />
          );
        }
        if (shape.kind === 'line') {
          return (
            <path
              key={shape.d}
              className={accent}
              d={shape.d}
              stroke="currentColor"
              strokeWidth={shape.width ?? 2}
            />
          );
        }
        return (
          <polygon
            key={shape.points}
            className={accent}
            points={shape.points}
            fill="currentColor"
            stroke="currentColor"
            strokeWidth={1.2}
          />
        );
      })}
    </svg>
  );
}
