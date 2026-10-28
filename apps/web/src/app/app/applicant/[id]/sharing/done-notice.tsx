'use client';

import { useEffect, useState } from 'react';

/**
 * The line a finished change to access leaves on Sharing (CCD quiet closure). It arrives in the
 * page address after a reload, so it is shown at once for everyone, read out once the page is
 * running (a live region is only announced when its words change after load), and then taken out
 * of the address, so a later reload, a Back or the next change never shows it again.
 */
export function DoneNotice({ line }: { readonly line: string }) {
  const [announced, setAnnounced] = useState('');
  useEffect(() => {
    setAnnounced(line);
    const url = new URL(window.location.href);
    if (url.searchParams.has('done')) {
      url.searchParams.delete('done');
      window.history.replaceState(window.history.state, '', url);
    }
  }, [line]);
  return (
    <>
      <p className="notice notice-ok u-mb-100">{line}</p>
      <output className="sr-only">{announced}</output>
    </>
  );
}
