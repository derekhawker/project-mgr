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

export function renderTicketMarkdown(content, window) {
  const { body } = splitTicketFrontmatter(content);
  return createDOMPurify(window).sanitize(marked.parse(body, { async: false }));
}
