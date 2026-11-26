export function normalizedLabel(label) {
  return String(label ?? "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

export const LABEL_COLOR_COUNT = 20;

export function labelColorIndex(label) {
  const normalized = normalizedLabel(label);
  let hash = 2166136261;
  for (const character of normalized) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % LABEL_COLOR_COUNT;
}
