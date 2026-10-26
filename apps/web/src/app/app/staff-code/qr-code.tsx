import 'server-only';
import { encode } from 'uqr';

/**
 * A QR code drawn as one inline vector shape. Black on white in every theme (a QR code must
 * keep its contrast to scan), no image address and no raw markup injection, so the page's
 * strict content policy needs no exception. The text is made on the server and never leaves it
 * except as this picture.
 */
export function QrCode({ text, label }: { readonly text: string; readonly label: string }) {
  const { data, size } = encode(text, { ecc: 'M', border: 2 });
  const parts: string[] = [];
  for (let y = 0; y < size; y += 1) {
    const row = data[y] ?? [];
    let x = 0;
    while (x < size) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < size && row[x]) x += 1;
      parts.push(`M${start} ${y}h${x - start}v1h-${x - start}z`);
    }
  }
  return (
    <svg
      role="img"
      aria-labelledby="qr-title"
      viewBox={`0 0 ${size} ${size}`}
      width={216}
      height={216}
      shapeRendering="crispEdges"
    >
      <title id="qr-title">{label}</title>
      <rect width={size} height={size} fill="#ffffff" />
      <path d={parts.join('')} fill="#000000" />
    </svg>
  );
}
