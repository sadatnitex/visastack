'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  getInstallPrompt,
  promptInstall,
  subscribeInstallPrompt,
} from '../../lib/pwa/install-prompt';
import { isStandalone } from '../../lib/pwa/runtime';

/**
 * The Help page's install card. Chromium browsers get a real Install VisaStack button once the
 * browser offers it; every browser gets written steps, because Safari never offers a button.
 * The privacy line matters as much as the button: installing never copies records to the phone.
 */
export function InstallAppCard() {
  const offer = useSyncExternalStore(subscribeInstallPrompt, getInstallPrompt, () => null);
  const [installed, setInstalled] = useState(false);
  const [declined, setDeclined] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone(window));
  }, []);

  const install = async () => {
    const outcome = await promptInstall();
    if (outcome === 'accepted') setInstalled(true);
    if (outcome === 'dismissed') setDeclined(true);
  };

  return (
    <article className="card" aria-labelledby="install-app-title">
      <h2 className="card-title" id="install-app-title">
        Use VisaStack on Your Phone
      </h2>
      {installed ? (
        <p>VisaStack is installed on this device. Open it from your home screen or app list.</p>
      ) : (
        <>
          <p>
            Add VisaStack to your home screen to open it like an app, with the same sign-in and the
            same records as this website.
          </p>
          {offer ? (
            <button type="button" className="btn btn-primary" onClick={install}>
              Install VisaStack
            </button>
          ) : null}
          {declined ? <p>You can install it any time from this page.</p> : null}
          <p>
            On iPhone or iPad, open VisaStack in Safari, tap Share, then Add to Home Screen. On
            Android, open the browser menu and choose Install App or Add to Home Screen.
          </p>
        </>
      )}
      <p>
        Installing does not download your records. Your details and documents stay protected on
        VisaStack and open only after you sign in.
      </p>
    </article>
  );
}
