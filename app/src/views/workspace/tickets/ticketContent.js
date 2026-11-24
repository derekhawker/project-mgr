import { marked } from "marked";
import createDOMPurify from "dompurify";

export function splitTicketFrontmatter(content) {
  const normalized = content.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return { body: normalized, fields: [] };
  const fields = match[1].split("\n").flatMap((line) => {
    const field = line.match(/^([\w-]+):\s*(.*)$/);
    return field ? [[field[1], field[2].replace(/^['"]|['"]$/g, "")]] : [];
  });
  return { body: normalized.slice(match[0].length), fields };
}

export function renderTicketMarkdown(content, window, title) {
  const { body } = splitTicketFrontmatter(content);
  const lines = body.split("\n");
  const firstContentLine = lines.findIndex((line) => line.trim());
  const heading = lines[firstContentLine]?.match(/^#\s+(.+?)\s*#*$/);
  if (title && heading?.[1]?.trim() === title.trim()) {
    lines.splice(firstContentLine, 1);
  }
  return createDOMPurify(window).sanitize(
    marked.parse(lines.join("\n"), { async: false }),
  );
}
