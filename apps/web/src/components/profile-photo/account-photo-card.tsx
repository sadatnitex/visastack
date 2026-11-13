import Link from 'next/link';
import { componentsMoreCatalog } from '../../i18n/components-more';
import { getT } from '../../lib/i18n-server';
import type { OwnPhoto } from '../../lib/profile-photos';
import { initialsOf } from './crop';
import { ProfilePhotoControl } from './profile-photo-control';

/**
 * Your photo, on the account page (WP-PH1). It is the photo on your own
 * traveller profile, so it shows beside your name across the workspace and
 * is managed in one place. Someone who has not added themselves as a
 * traveller is told how to.
 */
export async function AccountPhotoCard({ photo }: { readonly photo: OwnPhoto }) {
  const t = await getT(componentsMoreCatalog);
  const { self } = photo;
  return (
    <article className="card profile-photo-card">
      <p className="card-kicker">
        {t.node('componentsMore.profilePhotoAccountPhotoCard.profilePhoto')}
      </p>
      <h2 className="card-title">
        {t.node('componentsMore.profilePhotoAccountPhotoCard.yourPhoto')}
      </h2>
      <p className="card-body u-mb-125">
        {t.node('componentsMore.profilePhotoAccountPhotoCard.shownBesideYourNameInYour')}
      </p>
      {self ? (
        <ProfilePhotoControl
          applicantId={self.id}
          initials={initialsOf(self.name)}
          photoUrl={self.photoUrl}
          avatarClassName="profile-photo-card-avatar"
        />
      ) : (
        <>
          <p className="card-body u-mb-125">
            {t.node('componentsMore.profilePhotoAccountPhotoCard.addYourselfAsATravellerFirst')}
          </p>
          <Link href="/app/applicants" className="btn btn-secondary">
            {t.node('componentsMore.profilePhotoAccountPhotoCard.addYourself')}
          </Link>
        </>
      )}
    </article>
  );
}
