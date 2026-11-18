import { ImportPanel } from '../../src/app/app/applicant/[id]/import/import-panel';
import { ProfilePhotoControl } from '../../src/components/profile-photo/profile-photo-control';

/**
 * FIX9: the three hidden file pickers (Choose Files and Add a Folder on the import panel, Add
 * Photo on My Profile), as the real components on the real stylesheet. Used by
 * e2e/wallet/fix9-sticky-bar.spec.ts.
 */
export default function Fix9PickersFixture() {
  return (
    <div>
      <ImportPanel applicantId="44444444-4444-4444-8444-444444444444" limitLabel="4 MB" />
      <ProfilePhotoControl
        applicantId="44444444-4444-4444-8444-444444444444"
        photoUrl={null}
        initials="SA"
        avatarClassName="profile-identity-avatar"
      />
    </div>
  );
}
