import type { DocumentAction } from '@visastack/services';
import type { ComponentType } from 'react';
import { DeleteDuplicateAction } from './delete/delete-action';
import { RestoreDeletedAction } from './delete/restore-action';
import { ReplaceAction } from './replace/replace-action';

/** What every Manage action component receives (PROGRAMME section 3.4). */
export interface ManageActionProps {
  readonly applicantId: string;
  readonly documentId: string;
  /** The document's name as the list shows it, for the action's own wording. */
  readonly documentName: string;
  /** Close the action: the menu puts focus back on its button. */
  readonly onClose: () => void;
}

export interface ManageActionEntry {
  /** The menu item's words, Title Case (docs/uiux/ccd/VOCABULARY.md). */
  readonly label: string;
  readonly Component: ComponentType<ManageActionProps>;
}

/*
 * One entry per action a lane has built. An action with no entry yet is simply not listed, so
 * the Manage menu shows nothing until a lane registers one. Each lane inserts its entries only
 * directly below its own anchor (PROGRAMME section 5.2): A1 Archive and Restore, B Replace,
 * C Delete Duplicate and Restore from Recently Deleted, D the removal request and its cancel.
 */
export const MANAGE_ACTIONS: Readonly<Partial<Record<DocumentAction, ManageActionEntry>>> = {
  // LC-A1 actions
  // LC-B actions
  REPLACE: { label: 'Replace with a Newer Document', Component: ReplaceAction },
  // LC-C actions
  DELETE_DUPLICATE: { label: 'Delete Duplicate', Component: DeleteDuplicateAction },
  RESTORE_DELETED: { label: 'Restore', Component: RestoreDeletedAction },
  // LC-D actions
};

/** The registered entries for `actions`, in the order given (availableDocumentActions order). */
export function registeredActions(
  actions: readonly DocumentAction[],
  registry: Readonly<Partial<Record<DocumentAction, ManageActionEntry>>> = MANAGE_ACTIONS,
): Array<{ readonly action: DocumentAction; readonly entry: ManageActionEntry }> {
  return actions.flatMap((action) => {
    const entry = registry[action];
    return entry ? [{ action, entry }] : [];
  });
}
