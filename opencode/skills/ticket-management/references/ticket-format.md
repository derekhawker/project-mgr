# Ticket Format

Use a short lowercase kebab-case slug as the stable filename `<slug>.md` in the
canonical Workspace ticket directory. Closed tickets use
`archived/<slug>.md`.

New tickets start in `draft` and include YAML front matter with a title and
status. Include a session ID field when a work session is associated; it is the
exact OpenCode session ID used to resume that ticket. Keep the Markdown file the
source of truth for status and session identity.

A concise initial ticket can use:

```md
---
title: Short title
status: draft
---

# Short title

## Idea

[The user's observation, problem or question, preserving uncertainty.]

## Why It Matters

[The consequence or value stated only from the captured idea.]
```

As grooming proceeds, add the relevant high-level outcomes, scope, non-goals,
acceptance checks, validation, material decisions, and approval. The main ticket
remains authoritative for identity, status, outcomes, acceptance criteria, scope,
decisions, and session ID. For active execution, use the linked `.todo` as the
single actionable task list. Keep it to open work and a small optional
`Explore later` scratchpad; keep task-level decomposition out of the ticket and
historical narratives out of the TODO. For cancellation, record the reason and
disposition of completed and remaining work in the ticket.
