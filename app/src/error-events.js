export function cleanupErrorText(kind, payload = {}) {
  const detail = payload.failureDetail || payload.message || 'unknown error';
  if (kind === 'cleanup-recovery-error') return `Cleanup recovery failed: ${detail}`;
  if (kind === 'cleanup-job-error') return `Cleanup job ${payload.jobId || 'unknown'} failed: ${detail}`;
  return `Cleanup worker failed: ${detail}`;
}

export function showCleanupError(kind, payload, element) {
  const text = cleanupErrorText(kind, payload);
  if (element) element.textContent = text;
  return text;
}

export function clearNoticeIfStartsWith(element, prefix) {
  if (!element?.textContent.startsWith(prefix)) return false;
  element.textContent = '';
  element.hidden = true;
  return true;
}
