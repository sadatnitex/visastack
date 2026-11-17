import { INCOMING_PATH } from '../../lib/pwa/share-target';

/**
 * `/share-target` on the server (WP-PIC11). A share from another app is answered by the service
 * worker on the device and never reaches here. This route only runs when no worker is in charge
 * (a first visit, storage blocked, or the worker switched off): it never reads, keeps or logs what
 * was posted, and sends the person to `/app/incoming`, which explains that the share did not come
 * through. No route here serves a shared file: `/share-target/file/...` and `/share-target/list`
 * exist only inside the worker, so the server answers them with its not-found page.
 */
export function POST(): Response {
  return new Response(null, {
    status: 303,
    headers: {
      // Relative, so it never depends on the Host the request arrived with.
      Location: `${INCOMING_PATH}?missed=1`,
      'Cache-Control': 'no-store',
    },
  });
}
