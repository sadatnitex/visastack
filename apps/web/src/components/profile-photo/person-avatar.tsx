'use client';

import { useState } from 'react';

/**
 * A person's photo where their initials would show, falling back to the
 * initials when there is no photo or it cannot load (WP-PH1). Decorative: the
 * name is always written next to it, so it carries no text of its own.
 */
export function PersonAvatar({
  className,
  initials,
  photoUrl,
}: {
  readonly className: string;
  readonly initials: string;
  readonly photoUrl?: string | null | undefined;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = Boolean(photoUrl) && photoUrl !== failedUrl;
  return (
    <span className={className} aria-hidden="true" data-photo={showPhoto ? 'true' : undefined}>
      {showPhoto && photoUrl ? (
        <img
          className="person-avatar-photo"
          src={photoUrl}
          alt=""
          decoding="async"
          draggable={false}
          onError={() => setFailedUrl(photoUrl)}
        />
      ) : (
        initials
      )}
    </span>
  );
}
