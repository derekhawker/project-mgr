import { marked } from "marked";
import createDOMPurify from "dompurify";

// Only Markdown crosses the sanitized-HTML boundary. Text stays data for JSX.
// DOMPurify's factory requires a Window, not its Document.
export function createDocContentAdapter(
  window,
  {
    createSanitizer = createDOMPurify,
    parseMarkdown = (text) => marked.parse(text, { async: false }),
  } = {},
) {
  const sanitizer = createSanitizer(window);
  return (record) => {
    if (!record) return null;
    if (!/\.md$/i.test(record.path))
      return { kind: "text", text: record.contents };
    return {
      kind: "markdown",
      html: sanitizer.sanitize(parseMarkdown(record.contents)),
    };
  };
}
