/** The active pane owns the progress view; rows live outside that pane. */
export function newWorkProgressDestination(captureVisible, reviewVisible, workType) {
  if (captureVisible) return 'capture';
  if (!reviewVisible) return null;
  return workType === 'quick_request' ? 'quick_request' : 'workspace';
}
