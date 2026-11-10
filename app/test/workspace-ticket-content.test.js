import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { renderTicketMarkdown, splitTicketFrontmatter } from "../src/views/workspace/tickets/ticketContent.js";

test("ticket reader separates formatted frontmatter and sanitizes complete Markdown", () => {
  const dom = new JSDOM("");
  try {
    const body = `# Full ticket\n\n${"complete ".repeat(200)}<script>throw new Error('unsafe')</script>`;
    const content = `---\ntitle: Full ticket\nstatus: draft\nowner: Alice\n---\n${body}`;
    assert.deepEqual(splitTicketFrontmatter(content), {
      body,
      fields: [["title", "Full ticket"], ["status", "draft"], ["owner", "Alice"]],
    });
    const html = renderTicketMarkdown(content, dom.window);
    assert.match(html, /<h1>Full ticket<\/h1>/);
    assert.equal(html.includes("complete ".repeat(200)), true);
    assert.doesNotMatch(html, /<script/i);
  } finally {
    dom.window.close();
  }
});
