import Link from 'next/link';
import type { OwnPhoto } from '../../lib/profile-photos';
import { initialsOf } from './crop';
import { ProfilePhotoControl } from './profile-photo-control';

/**
 * Your photo, on the account page (WP-PH1). It is the photo on your own
 * traveller profile, so it shows beside your name across the workspace and
 * is managed in one place. Someone who has not added themselves as a
 * traveller is told how to.
 */
export function AccountPhotoCard({ photo }: { readonly photo: OwnPhoto }) {
  const { self } = photo;
  return (
    <article className="card profile-photo-card">
      <p className="card-kicker">Profile Photo</p>
      <h2 className="card-title">Your Photo</h2>
      <p className="card-body u-mb-125">
        Shown beside your name in your workspace. Only you can see it, and it is never used as a
        visa photo or shared.
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
          <p className="card-body u-mb-125">Add yourself as a traveller first to add your photo.</p>
          <Link href="/app/applicants" className="btn btn-secondary">
            Add Yourself
          </Link>
        </>
      )}
    </article>
  );
}
