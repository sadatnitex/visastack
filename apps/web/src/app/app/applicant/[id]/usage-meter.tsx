function mbLabel(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** A small usage bar for evidence-storage quotas — visible before a limit is hit, not just after. */
export function UsageMeter({
  label,
  usedBytes,
  limitBytes,
}: {
  readonly label: string;
  readonly usedBytes: number;
  readonly limitBytes: number;
}) {
  const fraction = limitBytes > 0 ? Math.min(1, usedBytes / limitBytes) : 0;
  const tone = fraction >= 1 ? 'meter-full' : fraction >= 0.85 ? 'meter-warn' : '';
  return (
    <div>
      <div className="meter-label">
        <span>{label}</span>
        <span>
          {mbLabel(usedBytes)} of {mbLabel(limitBytes)} used
        </span>
      </div>
      <div className="meter">
        <div
          className={`meter-fill ${tone}`.trim()}
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </div>
    </div>
  );
}
