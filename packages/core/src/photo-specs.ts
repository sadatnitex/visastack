/**
 * Visa photo sizes (owner request 2026-10-25): one stored passport-size photo, sized on request to
 * the published rule of each visa application.
 *
 * Every figure below comes from an official page or from the country research already in the repo
 * (packages/core/src/destinations/batch-001.json), and each spec names its source and the day it was
 * checked. A figure the source does not state is null, never guessed. Sizing a photo to one of these
 * rules does not mean it will be accepted: the person is always told to check the current rule.
 *
 * Pure data and arithmetic only, shared by the server (packages/adapters/src/photo-sizer.ts) and the
 * crop preview in the browser, so both always compute the same crop.
 */

export interface Millimetres {
  readonly widthMm: number;
  readonly heightMm: number;
}

export interface Pixels {
  readonly width: number;
  readonly height: number;
}

export interface Range {
  readonly min: number;
  readonly max: number;
}

export interface PhotoSpec {
  /** Stable id, used in requests and in the audit record. */
  readonly id: string;
  /** Plain name shown in the size list. */
  readonly name: string;
  /** Short size wording for messages: "35 x 45 mm", "2 x 2 inches", "200 x 200 pixels". */
  readonly sizeLabel: string;
  /** Printed size, when the source publishes one. */
  readonly physical: Millimetres | null;
  /** An exact pixel size the source requires (a digital-only rule). */
  readonly pixels: Pixels | null;
  /** A smallest digital size the source publishes. */
  readonly minPixels: Pixels | null;
  /** Output format. Every spec here is delivered as JPEG. */
  readonly format: 'JPEG';
  /** Published file size limits in kilobytes (1 KB = 1024 bytes), when the source states them. */
  readonly fileSizeKb: { readonly min: number | null; readonly max: number | null } | null;
  /** The background rule in plain words, when the source states one. */
  readonly backgroundRule: string | null;
  /** Head height, chin to top of head, in millimetres, when published. */
  readonly headHeightMm: Range | null;
  /** Any other published head or face rule, in plain words. */
  readonly headRule: string | null;
  readonly sourceUrl: string;
  readonly sourceTitle: string;
  readonly sourcePublisher: string;
  /** ISO date (YYYY-MM-DD) the source was last checked. */
  readonly checkedOn: string;
  /** Anything uncertain about this spec, in plain words. */
  readonly note: string | null;
}

const INCH_MM = 25.4;

/**
 * Checked on 2026-10-25 through search results of the official site: the build environment could
 * not open these pages directly. Said so in each note, so nobody reads more certainty into them.
 */
const SEEN_THROUGH_SEARCH =
  'Read from the official page through search results on 2026-10-25; open the page to confirm before relying on it.';

export const PHOTO_SPECS: readonly PhotoSpec[] = [
  {
    id: 'schengen-35x45',
    name: 'Schengen, 35 x 45 mm',
    sizeLabel: '35 x 45 mm',
    physical: { widthMm: 35, heightMm: 45 },
    pixels: null,
    minPixels: null,
    format: 'JPEG',
    fileSizeKb: null,
    backgroundRule: 'White background.',
    headHeightMm: null,
    headRule: 'The face covers 70% to 80% of the photo.',
    sourceUrl: 'https://dhaka.diplo.de/bd-en/service/2689080-2689080',
    sourceTitle: 'Information sheet: SCHENGEN VISA Tourism - Federal Foreign Office',
    sourcePublisher: 'Embassy of the Federal Republic of Germany, Dhaka',
    checkedOn: '2026-10-25',
    note: `This is the German Embassy Dhaka rule. Other Schengen countries word it slightly differently. ${SEEN_THROUGH_SEARCH}`,
  },
  {
    id: 'uk-35x45',
    name: 'United Kingdom, 35 x 45 mm',
    sizeLabel: '35 x 45 mm',
    physical: { widthMm: 35, heightMm: 45 },
    pixels: null,
    minPixels: { width: 600, height: 750 },
    format: 'JPEG',
    fileSizeKb: { min: 50, max: 10 * 1024 },
    backgroundRule: 'Plain, light-coloured background with no shadows.',
    headHeightMm: { min: 29, max: 34 },
    headRule: null,
    sourceUrl: 'https://www.gov.uk/photos-for-passports',
    sourceTitle: 'Get a passport photo: Digital photos - GOV.UK',
    sourcePublisher: 'HM Passport Office',
    checkedOn: '2026-10-25',
    note: `These are the UK passport photo rules. For a UK visa the photo is usually taken at the visa application centre. ${SEEN_THROUGH_SEARCH}`,
  },
  {
    id: 'us-2x2',
    name: 'United States, 2 x 2 inches',
    sizeLabel: '2 x 2 inches',
    physical: { widthMm: 2 * INCH_MM, heightMm: 2 * INCH_MM },
    pixels: null,
    minPixels: null,
    format: 'JPEG',
    fileSizeKb: null,
    backgroundRule: 'Plain white or off-white background.',
    headHeightMm: { min: 25, max: 35 },
    headRule: 'Head from chin to top of hair between 1 inch and 1 3/8 inches.',
    sourceUrl:
      'https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/photos.html',
    sourceTitle: 'Photo Requirements',
    sourcePublisher: 'U.S. Department of State, Bureau of Consular Affairs',
    checkedOn: '2026-10-25',
    note: `The online form sets its own upload limits, which are not recorded here. ${SEEN_THROUGH_SEARCH}`,
  },
  {
    id: 'canada-35x45',
    name: 'Canada, 35 x 45 mm',
    sizeLabel: '35 x 45 mm',
    physical: { widthMm: 35, heightMm: 45 },
    pixels: null,
    minPixels: null,
    format: 'JPEG',
    fileSizeKb: null,
    backgroundRule: null,
    headHeightMm: { min: 31, max: 36 },
    headRule: null,
    sourceUrl:
      'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/temporary-resident-visa-application-photograph-specifications.html',
    sourceTitle: 'Temporary Resident Visa application photograph specifications - Canada.ca',
    sourcePublisher: 'Immigration, Refugees and Citizenship Canada',
    checkedOn: '2026-10-25',
    note: `35 x 45 mm is the smallest frame allowed. The background rule was not part of what was checked. ${SEEN_THROUGH_SEARCH}`,
  },
  {
    id: 'china-33x48',
    name: 'China, 33 x 48 mm',
    sizeLabel: '33 x 48 mm',
    physical: { widthMm: 33, heightMm: 48 },
    pixels: null,
    minPixels: null,
    format: 'JPEG',
    fileSizeKb: null,
    backgroundRule: null,
    headHeightMm: { min: 28, max: 33 },
    headRule: 'Head 21 to 24 mm wide.',
    sourceUrl: 'https://np.china-embassy.gov.cn/eng/News/202303/t20230314_11041189.htm',
    sourceTitle: 'Requirements for Chinese Visa Application (4 December 2023)',
    sourcePublisher: "Embassy of the People's Republic of China in Nepal",
    checkedOn: '2026-10-25',
    note: `Head width differs between Chinese visa centres (some say 15 to 22 mm), and the background rule (usually white) is on each centre's own notice. ${SEEN_THROUGH_SEARCH}`,
  },
  {
    id: 'india-2x2',
    name: 'India, 2 x 2 inches',
    sizeLabel: '2 x 2 inches',
    physical: { widthMm: 2 * INCH_MM, heightMm: 2 * INCH_MM },
    pixels: null,
    minPixels: null,
    format: 'JPEG',
    fileSizeKb: null,
    backgroundRule: 'White background, full face.',
    headHeightMm: null,
    headRule: null,
    sourceUrl: 'https://hcidhaka.gov.in/pdf/Visa_Category_Wise_Documents_Required_13082026.pdf',
    sourceTitle: 'Documents Required for Indian Visa Application',
    sourcePublisher: 'High Commission of India, Dhaka',
    checkedOn: '2026-10-14',
    note: 'From the country research in this product. The online e-Visa form sets its own upload rules.',
  },
  {
    id: 'thailand-35x45',
    name: 'Thailand, 35 x 45 mm',
    sizeLabel: '35 x 45 mm',
    physical: { widthMm: 35, heightMm: 45 },
    pixels: null,
    minPixels: null,
    format: 'JPEG',
    fileSizeKb: null,
    backgroundRule: 'White background, taken within the past 6 months.',
    headHeightMm: null,
    headRule: null,
    sourceUrl:
      'https://dhaka.thaiembassy.org/en/publicservice/tourist-visa-tr?menu=5d83296315e39c2540006a6d&page=5d83296315e39c2540006a6c',
    sourceTitle: 'Tourist Visa (TR) - Royal Thai Embassy, Dhaka',
    sourcePublisher: 'Royal Thai Embassy, Dhaka',
    checkedOn: '2026-10-14',
    note: 'From the country research in this product.',
  },
  {
    id: 'saudi-200px',
    name: 'Saudi Arabia, 200 x 200 pixels',
    sizeLabel: '200 x 200 pixels',
    physical: null,
    pixels: { width: 200, height: 200 },
    minPixels: null,
    format: 'JPEG',
    fileSizeKb: { min: 5, max: 100 },
    backgroundRule: null,
    headHeightMm: null,
    headRule: null,
    sourceUrl: 'https://visa.visitsaudi.com/Home/PhotoSpecifications',
    sourceTitle: 'Photo Specifications - KSA Visa',
    sourcePublisher: 'Ministry of Foreign Affairs, Kingdom of Saudi Arabia',
    checkedOn: '2026-10-14',
    note: 'From the country research in this product, which marks this page for a recheck because the portal builds its pages with scripts.',
  },
];

export function getPhotoSpec(id: string): PhotoSpec | undefined {
  return PHOTO_SPECS.find((spec) => spec.id === id);
}

/** Width divided by height of the finished photo. */
export function specAspect(spec: PhotoSpec): number {
  if (spec.pixels) return spec.pixels.width / spec.pixels.height;
  if (spec.physical) return spec.physical.widthMm / spec.physical.heightMm;
  return 1;
}

/** Print resolutions offered: 600 DPI when the photo is large enough, else 300 DPI. */
export const PRINT_DPI_HIGH = 600;
export const PRINT_DPI_STANDARD = 300;

function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm / INCH_MM) * dpi);
}

/** The pixel size a printed spec needs at `dpi`. */
export function printPixels(physical: Millimetres, dpi: number): Pixels {
  return { width: mmToPx(physical.widthMm, dpi), height: mmToPx(physical.heightMm, dpi) };
}

/** The smallest source crop that still prints this spec properly (300 DPI), or its exact pixels. */
export function minimumPixels(spec: PhotoSpec): Pixels {
  if (spec.pixels) return spec.pixels;
  if (!spec.physical) return { width: 1, height: 1 };
  return printPixels(spec.physical, PRINT_DPI_STANDARD);
}

export interface OutputPlan {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly dpi: number;
}

/**
 * The finished photo's pixel size and DPI. An exact pixel rule is followed exactly (300 DPI recorded
 * as a nominal value). A printed size is made at 600 DPI when the chosen crop holds enough detail, or
 * when the spec's own digital minimum needs it; otherwise at 300 DPI.
 */
export function outputPlan(spec: PhotoSpec, crop: Pixels): OutputPlan {
  if (spec.pixels) {
    return { widthPx: spec.pixels.width, heightPx: spec.pixels.height, dpi: PRINT_DPI_STANDARD };
  }
  const physical = spec.physical ?? { widthMm: 35, heightMm: 45 };
  const high = printPixels(physical, PRINT_DPI_HIGH);
  const standard = printPixels(physical, PRINT_DPI_STANDARD);
  const minimumNeedsHigh =
    spec.minPixels !== null &&
    (standard.width < spec.minPixels.width || standard.height < spec.minPixels.height);
  const sourceSupportsHigh = crop.width >= high.width && crop.height >= high.height;
  const dpi = minimumNeedsHigh || sourceSupportsHigh ? PRINT_DPI_HIGH : PRINT_DPI_STANDARD;
  const size = dpi === PRINT_DPI_HIGH ? high : standard;
  return { widthPx: size.width, heightPx: size.height, dpi };
}

/** Published file size limits in bytes, or null when the source states none. */
export function fileSizeRangeBytes(
  spec: PhotoSpec,
): { readonly min: number | null; readonly max: number | null } | null {
  if (!spec.fileSizeKb) return null;
  return {
    min: spec.fileSizeKb.min === null ? null : spec.fileSizeKb.min * 1024,
    max: spec.fileSizeKb.max === null ? null : spec.fileSizeKb.max * 1024,
  };
}

// --- Crop -------------------------------------------------------------------

/** How far the person moved and zoomed the crop. Offsets run from -1 (left/up) to 1 (right/down). */
export interface CropInput {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly zoom: number;
}

export const CROP_ZOOM_MIN = 1;
export const CROP_ZOOM_MAX = 3;
export const CENTRED_CROP: CropInput = Object.freeze({ offsetX: 0, offsetY: 0, zoom: 1 });

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Validates and clamps a crop request. Returns undefined for anything that is not a finite number,
 * so a malformed request is refused rather than silently centred.
 */
export function clampCropInput(input: {
  readonly offsetX: unknown;
  readonly offsetY: unknown;
  readonly zoom: unknown;
}): CropInput | undefined {
  const values = [input.offsetX, input.offsetY, input.zoom];
  if (!values.every((v) => typeof v === 'number' && Number.isFinite(v))) return undefined;
  return {
    offsetX: clamp(input.offsetX as number, -1, 1),
    offsetY: clamp(input.offsetY as number, -1, 1),
    zoom: clamp(input.zoom as number, CROP_ZOOM_MIN, CROP_ZOOM_MAX),
  };
}

export interface CropBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The part of a `sourceWidth` x `sourceHeight` photo to keep for a finished photo of `aspect`
 * (width / height). At zoom 1 it is the largest box of that shape that fits; zooming in shrinks it
 * around its centre, and the offsets slide it within the space left over. Always whole pixels,
 * always inside the photo, never empty.
 */
export function computeCropBox(
  sourceWidth: number,
  sourceHeight: number,
  aspect: number,
  input: CropInput = CENTRED_CROP,
): CropBox {
  const w = Math.max(1, Math.floor(sourceWidth));
  const h = Math.max(1, Math.floor(sourceHeight));
  const crop = clampCropInput(input) ?? CENTRED_CROP;
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const baseWidth = w / h > safeAspect ? h * safeAspect : w;
  const baseHeight = w / h > safeAspect ? h : w / safeAspect;
  const width = clamp(Math.round(baseWidth / crop.zoom), 1, w);
  const height = clamp(Math.round(baseHeight / crop.zoom), 1, h);
  const slackX = w - width;
  const slackY = h - height;
  const left = clamp(Math.round(slackX / 2 + (crop.offsetX * slackX) / 2), 0, slackX);
  const top = clamp(Math.round(slackY / 2 + (crop.offsetY * slackY) / 2), 0, slackY);
  return { left, top, width, height };
}

// --- Guided checks ----------------------------------------------------------

/** What the image sizer measured. Deterministic numbers only: no face detection, no AI. */
export interface PhotoMeasurements {
  /** Pixel size after the camera's rotation flag is applied. */
  readonly width: number;
  readonly height: number;
  /** Mean brightness, 0 (black) to 255 (white). */
  readonly meanLuma: number;
  /** Spread of brightness: a low value means a flat, low-contrast photo. */
  readonly lumaStdDev: number;
  /** Variance of the Laplacian (edge strength) over the middle of a fixed-size copy: low means blurry. */
  readonly sharpness: number;
  /** Average colour spread inside the top and side border strips: high means a busy background. */
  readonly borderStdDev: number;
  /** Mean brightness of those strips. */
  readonly borderMeanLuma: number;
}

/** Heuristic limits. Advisory only: they never block a download and never claim acceptance. */
export const PHOTO_CHECK_LIMITS = Object.freeze({
  tooDarkBelow: 70,
  tooBrightAbove: 225,
  lowContrastBelow: 18,
  blurryBelow: 60,
  busyBackgroundAbove: 24,
  darkBackgroundBelow: 150,
});

export type PhotoFindingId =
  | 'not_portrait'
  | 'too_small'
  | 'too_dark'
  | 'too_bright'
  | 'low_contrast'
  | 'blurry'
  | 'background_not_plain'
  | 'background_not_light';

export interface PhotoFinding {
  readonly id: PhotoFindingId;
  readonly title: string;
  readonly detail: string;
}

/**
 * Plain-language findings from the measurements. Each "too small" finding names the size it cannot
 * be printed at, once per size. An empty list means the basic checks found nothing, not that the
 * photo will be accepted.
 */
export function photoFindings(
  m: PhotoMeasurements,
  specs: readonly PhotoSpec[] = PHOTO_SPECS,
): PhotoFinding[] {
  const findings: PhotoFinding[] = [];
  if (m.width > m.height) {
    findings.push({
      id: 'not_portrait',
      title: 'Photo is wider than it is tall',
      detail: 'Use an upright photo with your head and shoulders in the middle.',
    });
  }
  const seen = new Set<string>();
  for (const spec of specs) {
    if (seen.has(spec.sizeLabel)) continue;
    const box = computeCropBox(m.width, m.height, specAspect(spec));
    const need = minimumPixels(spec);
    if (box.width < need.width || box.height < need.height) {
      seen.add(spec.sizeLabel);
      findings.push({
        id: 'too_small',
        title: spec.pixels
          ? `Too small for ${spec.sizeLabel}`
          : `Too small to print at ${spec.sizeLabel}`,
        detail: `This size needs at least ${need.width} x ${need.height} pixels. Your photo is ${m.width} x ${m.height}. Use a larger photo.`,
      });
    }
  }
  if (m.meanLuma < PHOTO_CHECK_LIMITS.tooDarkBelow) {
    findings.push({
      id: 'too_dark',
      title: 'Too dark',
      detail: 'Take the photo again in even, bright light.',
    });
  } else if (m.meanLuma > PHOTO_CHECK_LIMITS.tooBrightAbove) {
    findings.push({
      id: 'too_bright',
      title: 'Too bright',
      detail: 'Parts of the photo may be washed out. Avoid direct flash or strong light.',
    });
  }
  if (m.lumaStdDev < PHOTO_CHECK_LIMITS.lowContrastBelow) {
    findings.push({
      id: 'low_contrast',
      title: 'Low contrast',
      detail: 'Your face may not stand out clearly. Use more even light.',
    });
  }
  if (m.sharpness < PHOTO_CHECK_LIMITS.blurryBelow) {
    findings.push({
      id: 'blurry',
      title: 'Looks blurry',
      detail: 'Hold the camera still and make sure your face is in focus.',
    });
  }
  if (m.borderStdDev > PHOTO_CHECK_LIMITS.busyBackgroundAbove) {
    findings.push({
      id: 'background_not_plain',
      title: 'Background is not plain',
      detail: 'Stand in front of a plain wall with nothing behind you.',
    });
  } else if (m.borderMeanLuma < PHOTO_CHECK_LIMITS.darkBackgroundBelow) {
    findings.push({
      id: 'background_not_light',
      title: 'Background is not light',
      detail: 'Most rules ask for a white or light background.',
    });
  }
  return findings;
}
