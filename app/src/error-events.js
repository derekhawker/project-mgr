export function cleanupErrorText(kind, payload = {}) {
  const detail = payload.failureDetail || payload.message || 'unknown error';
  if (kind === 'cleanup-recovery-error') return `Cleanup recovery failed: ${detail}`;
  if (kind === 'cleanup-job-error') return `Cleanup job ${payload.jobId || 'unknown'} failed: ${detail}`;
  return `Cleanup worker failed: ${detail}`;
}
