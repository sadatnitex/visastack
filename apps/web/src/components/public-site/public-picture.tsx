import { PassportCover } from '../pictures/passport-cover';
import './public-site.css';
import './public-scenes.css';

/**
 * True for a picture served by this site: a path from the site root, never another origin, a
 * protocol-relative address, or a picture written into the page itself (img-src 'self').
 */
export function isSelfHosted(src: string): boolean {
  return /^\/(?!\/)[\w\-./]+$/.test(src) && !src.includes('..');
}

export interface PublicPictureProps {
  readonly src: string;
  /** Plain words for the picture, or an empty string when the words around it already say it. */
  readonly alt: string;
  readonly width: number;
  readonly height: number;
  /** True for the one picture on the first screen, which should not wait. */
  readonly eager?: boolean;
  readonly className?: string;
}

/** A self-hosted picture with its size set, so the page never jumps, lazy unless it leads. */
export function PublicPicture({
  src,
  alt,
  width,
  height,
  eager = false,
  className,
}: PublicPictureProps) {
  if (!isSelfHosted(src)) throw new Error(`Public pictures are served by this site: ${src}`);
  return (
    <img
      className={className ? `pub-picture ${className}` : 'pub-picture'}
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
    />
  );
}

/** A soft brand glow placed behind a hero picture (inside a positioned parent). Decoration only. */
export function DepthGlow() {
  return <span className="pub-glow" data-pub-depth="" aria-hidden="true" />;
}

export interface PassportTiltProps {
  /** The nationality whose cover is shown; the public story shows the real Bangladesh cover. */
  readonly nationality?: string;
  readonly width?: number;
  /** Plain words for the cover, or leave out when the words around it name it. */
  readonly label?: string;
}

/**
 * The passport cover that rests on the page and tilts into place as its scene runs. It is a picture
 * of the type of passport, never of anyone's own. Still, and fully shown, without motion.
 */
export function PassportTilt({ nationality = 'BD', width = 220, label }: PassportTiltProps) {
  return (
    <div className="pub-passport-tilt" data-pub-depth="">
      <PassportCover
        nationality={nationality}
        width={width}
        {...(label ? { label } : { decorative: true })}
      />
    </div>
  );
}
