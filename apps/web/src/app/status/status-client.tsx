'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VersionNoticeCopy } from '../../components/version-notice';
import { type ProbeResult, StatusView } from './status-view';

/**
 * The public status page: polls the real health checks (`/api/health/live` and
 * `/api/health/ready`) and hands the answers to `StatusView`, which words them for a
 * visitor. Refreshes itself; the checks themselves are unchanged and still available
 * to monitoring tools.
 */

async function probe(path: string): Promise<ProbeResult> {
  try {
    const res = await fetch(path, { cache: 'no-store' });
    const data = (await res.json().catch(() => ({}))) as ProbeResult['data'];
    const statusValue = data.status;
    const status = typeof statusValue === 'string' ? statusValue : String(res.status);
    return { ok: res.ok, status, data };
  } catch {
    return { ok: false, status: 'unreachable', data: {} };
  }
}

export function StatusClient({
  versionNotice = null,
}: { readonly versionNotice?: VersionNoticeCopy | null } = {}) {
  const [live, setLive] = useState<ProbeResult | null>(null);
  const [ready, setReady] = useState<ProbeResult | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [l, r] = await Promise.all([probe('/api/health/live'), probe('/api/health/ready')]);
    setLive(l);
    setReady(r);
    setUpdatedAt(new Date().toLocaleTimeString());
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 15000);
    return () => clearInterval(id);
  }, [refresh]);

  // A link to a place on this page (the footer's "About This Version") lands before the feature
  // list arrives; the list then pushes that place down, off a phone screen. Once the first answer
  // is on the page, bring the linked place back into view, once.
  const settled = useRef(false);
  useEffect(() => {
    if (ready === null || settled.current) return;
    settled.current = true;
    const target = decodeURIComponent(window.location.hash.slice(1));
    if (target) document.getElementById(target)?.scrollIntoView({ block: 'start' });
  }, [ready]);

  return (
    <StatusView
      live={live}
      ready={ready}
      updatedAt={updatedAt}
      loading={loading}
      onRefresh={() => void refresh()}
      versionNotice={versionNotice}
    />
  );
}
