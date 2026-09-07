---
name: writing-pr
description: "Use when writing or editing a pull request title or body."
---

# Writing a PR Body / Title

## Be concise, not thorough

Do not write essays. Do not report that you ran tests or validation — the body
never says "I ran tests" or includes a validation section. Write a concise body
and let the diff speak.

Use bullet points for whatever prose you do write.

## Lead with artifacts, not narration

Focus the body on:

- Mermaid codeblock diagrams
- Code samples or snippets (internal code paths, or sample usage of the change)

## Visual changes

If the change affects visuals — directly or indirectly — show a table of
before and after, with uploaded images or videos in the cells.

## Benchmarks

Always show before/after tables:

| | baseline | candidate |
| --- | --- | --- |
| metric | target branch | this PR |

## Only the final commit matters

Do not narrate intermediate PR history. If the PR shrank from +6k lines to
+1k lines, do not mention it. If the work was refactored from one commit to
another, do not mention it. Commentary describes only the final aggregate
squash-merge commit.

## Exception: genuinely big changes

For truly impressive, difficult, or high-risk/wide-scoped changes, write the
body like a technical blog post — context, storytelling, code samples,
before/after comparisons, diagrams, images, whatever serves the reader.

## Code references

Feel free to use code refs (files, symbols, permalinks) throughout.
