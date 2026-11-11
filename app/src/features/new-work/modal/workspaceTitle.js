export function workspaceTitleFromRepositoryName(name) {
  return String(name ?? "")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toLocaleUpperCase() + word.slice(1))
    .join(" ");
}
