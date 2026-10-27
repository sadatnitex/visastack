/**
 * What the profile screen needs to draw the sections, shaped so it can cross from the server to the
 * browser as plain data. The catalogue itself never ships to the browser: the server builds these
 * from it (master-profile.ts) and the screen only reads them.
 */

export interface EditorFieldDef {
  readonly key: string;
  readonly label: string;
  readonly sensitivity: 'STANDARD' | 'SENSITIVE' | 'RESTRICTED';
  readonly type?: 'text' | 'date';
  readonly placeholder?: string;
  /** A closed set of values. When the field accepts "Other" the list already ends with it. */
  readonly options?: readonly string[];
  /** The text field that opens when this choice is set to "Other". */
  readonly otherDetail?: EditorFieldDef;
  /**
   * Optional and never counted (before or after tax): blank already means not recorded, so it
   * offers no "does not apply" control.
   */
  readonly optional?: boolean;
}

export interface EditorGroup {
  readonly key: string;
  readonly label: string;
  readonly fields: readonly EditorFieldDef[];
  /** The person said they have none of these. */
  readonly noneDeclared: boolean;
}

export type SectionReason = 'default' | 'opened' | 'has_data' | 'locked';

/** A kind of document that backs a section's details, and how many of it are on file. */
export interface SectionDocument {
  readonly key: string;
  readonly label: string;
  /** Embassies usually want the original handed in; a scan here keeps it ready to share. */
  readonly original: boolean;
  /** How many usable copies are on file; null when that could not be checked. */
  readonly uploaded: number | null;
}

export interface EditorSection {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly layer: string;
  readonly open: boolean;
  readonly reason: SectionReason;
  /** True only for a section the person opened on purpose and that holds no saved detail. */
  readonly canClose: boolean;
  /** Plain note for a section that adds extra detail to one that is open from the start. */
  readonly extendsLabel?: string;
  readonly suggested: boolean;
  /** Number of details that count toward completion. */
  readonly detailCount: number;
  readonly answered: number;
  readonly total: number;
  /** Open sections only. */
  readonly singles: readonly EditorFieldDef[];
  readonly groups: readonly EditorGroup[];
  /** Field keys the person marked "does not apply". */
  readonly notApplicable: readonly string[];
  /** Locked sections list what they hold, so nothing is hidden. */
  readonly previewLabels: readonly string[];
  /** Documents that back this section's details (from the catalogue's links), open sections only. */
  readonly documents?: readonly SectionDocument[];
  /** The free "Something else" record for this section. */
  readonly otherItem: {
    readonly pack: string;
    readonly sectionFieldKey: string;
    readonly fields: readonly EditorFieldDef[];
  };
}

export interface EditorLayer {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly sections: readonly EditorSection[];
  readonly openCount: number;
}

/**
 * One entry of the Essentials First list (lib/profile-essentials.ts), shaped for the screen. A single
 * detail carries `field`; the home address carries `group`, the same repeating record its section uses.
 */
export interface EssentialItem {
  readonly key: string;
  readonly label: string;
  readonly hint?: string;
  /** The section that holds it, so the full view can be opened at the right place. */
  readonly sectionKey: string;
  /** Judged exactly as completion judges it: a value, "does not apply", or "none" for a record. */
  readonly answered: boolean;
  /** A single detail the person marked "does not apply". */
  readonly notApplicable: boolean;
  readonly field?: EditorFieldDef;
  readonly group?: EditorGroup;
}

export interface EssentialsView {
  readonly items: readonly EssentialItem[];
  readonly answered: number;
  readonly total: number;
}

export interface MasterProfileView {
  /** The short starter list shown first, with its own progress. */
  readonly essentials: EssentialsView;
  readonly percent: number;
  readonly answered: number;
  readonly total: number;
  readonly openSections: number;
  readonly totalSections: number;
  readonly layers: readonly EditorLayer[];
  readonly families: readonly { readonly key: string; readonly label: string }[];
  readonly suggestedFamily: string | null;
  /** Locked sections the chosen purpose suggests. */
  readonly suggestedLockedCount: number;
}

/** A named group of choices for a pick-list, built on the server so the catalogue stays out of the browser. */
export interface ChoiceGroup {
  readonly key: string;
  readonly label: string;
  readonly choices: readonly { readonly key: string; readonly label: string }[];
}
