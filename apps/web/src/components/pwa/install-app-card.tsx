'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { componentsPwaCatalog } from '../../i18n/components-pwa';
import {
  getInstallPrompt,
  promptInstall,
  subscribeInstallPrompt,
} from '../../lib/pwa/install-prompt';
import { isStandalone } from '../../lib/pwa/runtime';
import { useT } from '../i18n-provider';

/**
 * The Help page's install card. Chromium browsers get a real Install VisaStack button once the
 * browser offers it; every browser gets written steps, because Safari never offers a button.
 * The privacy line matters as much as the button: installing never copies records to the phone.
 */
export function InstallAppCard() {
  const t = useT(componentsPwaCatalog);
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
        {t.node('componentsPwa.pwaInstallAppCard.useVisastackOnYourPhone')}
      </h2>
      {installed ? (
        <p>{t.node('componentsPwa.pwaInstallAppCard.visastackIsInstalledOnThisDevice')}</p>
      ) : (
        <>
          <p>{t.node('componentsPwa.pwaInstallAppCard.addVisastackToYourHomeScreen')}</p>
          {offer ? (
            <button type="button" className="btn btn-primary" onClick={install}>
              {t.node('componentsPwa.pwaInstallAppCard.installVisastack')}
            </button>
          ) : null}
          {declined ? (
            <p>{t.node('componentsPwa.pwaInstallAppCard.youCanInstallItAnyTime')}</p>
          ) : null}
          <p>{t.node('componentsPwa.pwaInstallAppCard.onIphoneOrIpadOpenVisastack')}</p>
        </>
      )}
      <p>{t.node('componentsPwa.pwaInstallAppCard.installingDoesNotDownloadYourRecords')}</p>
    </article>
  );
}
