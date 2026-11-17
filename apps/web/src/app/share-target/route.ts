/**
 * `/share-target` on the server (WP-PIC11). A share from another app is answered by the service
 * worker on the device and never reaches here. This route only runs when no worker is in charge
 * (a first visit, storage blocked, or the worker switched off): it never reads, keeps or logs what
 * was posted (only the address is used), and sends the person to the shared files page, which
 * explains that the share did not come through. No route here serves a shared file:
 * `/share-target/file/...` and `/share-target/list` exist only inside the worker, so the server
 * answers them with its not-found page.
 */
export function POST(request: Request): Response {
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL('/app/incoming?missed=1', request.url).toString(),
      'Cache-Control': 'no-store',
    },
  });
}
