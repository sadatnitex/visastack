'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Live System Status — a functional client page that polls the real health
 * endpoints (`/api/health/live` and `/api/health/ready`) and renders them with
 * Apple-style status badges. Auto-refreshes; respects the same design system.
 */

type Json = Record<string, unknown>;

interface Probe {
  readonly ok: boolean;
  readonly status: string;
  readonly data: Json;
  readonly error?: string;
}

async function probe(path: string): Promise<Probe> {
  try {
    const res = await fetch(path, { cache: 'no-store' });
    const data = (await res.json().catch(() => ({}))) as Json;
    const statusValue = (data as { status?: unknown }).status;
    const status = typeof statusValue === 'string' ? statusValue : String(res.status);
    return { ok: res.ok, status, data };
  } catch (err) {
    return { ok: false, status: 'unreachable', data: {}, error: (err as Error).message };
  }
}

function badgeClass(status: string, ok: boolean): string {
  if (ok && (status === 'ready' || status === 'live' || status === 'ok'))
    return 'badge badge-success';
  if (status === 'not_ready' || status === 'degraded') return 'badge badge-warning';
  return 'badge badge-danger';
}

/** Flatten a probe payload (one level deep) into displayable key/value rows. */
function toRows(data: Json): Array<{ key: string; value: string }> {
  const rows: Array<{ key: string; value: string }> = [];
  for (const [key, value] of Object.entries(data)) {
    if (key === 'status') continue;
    if (value !== null && typeof value === 'object') {
      for (const [k2, v2] of Object.entries(value as Json)) {
        rows.push({ key: `${key}.${k2}`, value: format(v2) });
      }
    } else {
      rows.push({ key, value: format(value) });
    }
  }
  return rows;
}

function format(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

function ProbeCard({
  title,
  path,
  probeResult,
}: { title: string; path: string; probeResult: Probe | null }) {
  return (
    <article className="card">
      <div className="toolbar" style={{ marginBottom: '1rem' }}>
        <h2 className="card-title" style={{ margin: 0 }}>
          {title}
        </h2>
        {probeResult ? (
          <span className={badgeClass(probeResult.status, probeResult.ok)}>
            {probeResult.status}
          </span>
        ) : (
          <span className="badge badge-neutral">checking…</span>
        )}
      </div>
      <p className="card-kicker" style={{ marginBottom: '0.75rem' }}>
        {path}
      </p>
      {probeResult && (
        <div className="rows">
          {toRows(probeResult.data).map((r) => (
            <div className="row" key={r.key}>
              <span className="row-key">{r.key}</span>
              <span className="row-val">{r.value}</span>
            </div>
          ))}
          {probeResult.error && (
            <div className="row">
              <span className="row-key">error</span>
              <span className="row-val">{probeResult.error}</span>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export default function StatusPage() {
  const [live, setLive] = useState<Probe | null>(null);
  const [ready, setReady] = useState<Probe | null>(null);
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

  return (
    <section className="section container">
      <div className="section-head" style={{ textAlign: 'left', marginBottom: '2rem' }}>
        <span className="eyebrow">Live</span>
        <h1 className="section-title" style={{ margin: '0 0 0.5rem' }}>
          System status
        </h1>
        <p className="section-sub" style={{ margin: 0 }}>
          Polled directly from production health probes. Liveness reports the process. Readiness
          gives one verdict, ready or degraded, that already accounts for configuration, database
          connectivity and whether every migration is applied; the breakdown behind it is shown to
          administrators only, and no secret value or setting name is ever public.
        </p>
      </div>

      <div className="toolbar">
        <span className="muted" style={{ fontSize: '0.9rem' }}>
          {updatedAt ? `Updated ${updatedAt} · auto-refreshes every 15s` : 'Loading…'}
        </span>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh now'}
        </button>
      </div>

      <div className="grid">
        <ProbeCard title="Liveness" path="/api/health/live" probeResult={live} />
        <ProbeCard title="Readiness" path="/api/health/ready" probeResult={ready} />
      </div>
    </section>
  );
}
