import type { ReactNode } from 'react';
import { WorkspaceFrame } from '../../../app/workspace-frame';

export const dynamic = 'force-dynamic';

/**
 * The signed-in answers page sits in the same workspace frame as the rest of the signed-in product
 * (sidebar, top bar, account menu), so opening it from the menu no longer swaps to the public site
 * header. The frame is attached to this one page only: the guest link pages under `/collect` and
 * the open-request page keep their own minimal look, and nothing here reads an account for them.
 * The sign-in check for `/collect/account` runs in the middleware before this layout renders.
 */
export default function AnswersLayout({ children }: { readonly children: ReactNode }) {
  return <WorkspaceFrame>{children}</WorkspaceFrame>;
}
