export function filterQuickRequests(records, rawQuery) {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return records;
  return records.filter((record) => (record.prompt ?? 'Prompt unavailable').toLocaleLowerCase().includes(query));
}
