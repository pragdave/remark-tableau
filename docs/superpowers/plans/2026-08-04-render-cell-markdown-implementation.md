# Render `<tableau-md>` Cell Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `remarkTableau` actually render the Markdown inside every `<tableau-md>` marker `ts-tableau` emits, using a cell-content sub-pipeline that automatically inherits the consumer's own remark-syntax plugins.

**Architecture:** `src/index.ts`'s attacher becomes a regular `function` (not an arrow function) so it can use `this` — bound by unified to the processor it's attached to — to read `this.attachers` (the array of `[plugin, ...params]` tuples every `.use()` call has queued) and replay every entry onto a fresh `unified()` processor *except remarkTableau itself* (filtered by function-reference identity), then extend that with `remark-rehype`/`rehype-stringify` to build a self-contained cell-rendering sub-pipeline. (An earlier draft of this plan used `this()`-cloning instead; that doesn't work — see Global Constraints below — the explicit filter is required.) The main transform becomes `async`, extracting and replacing every `<tableau-md>` marker in the generated HTML string before wrapping it in the mdast `html` node, same as today.

**Tech Stack:** TypeScript, Vitest, `unified`/`remark`/`rehype` ecosystem, `ts-tableau` (unchanged).

## Global Constraints

- No new plugin, no new package export — everything lives inside the existing `remarkTableau` default export.
- Marker extraction regex: `` /<tableau-md>([\s\S]*?)<\/tableau-md>/g `` — safe because `ts-tableau`'s `escape_markdown()` guarantees escaped cell content can never contain a literal `<`.
- Unescaping order (reversing `escape_markdown`'s escape order): `&gt;`→`>` first, then `&lt;`→`<`, then `&amp;`→`&` last.
- Cell sub-pipeline: built by iterating `this.attachers` (the array unified's own `Processor.prototype.copy()` reads to implement `this()`-cloning — a documented mechanism, not a private workaround) and calling `.use(attacher, ...params)` on a fresh `unified()` processor for every entry **except** the one whose plugin is `remarkTableau` itself (`attacher !== remarkTableau`), then `.use(remarkRehype).use(rehypeStringify)` on top. **Do not use `this()` for this** — it does not exclude remarkTableau. unified's `.use()` only queues plugins by pushing onto `this.attachers`; attacher functions run later, during `.freeze()`, which iterates the already-complete `this.attachers` array. By the time remarkTableau's own attacher body executes, its own entry is unavoidably already in `this.attachers`, so `this()` clones it right back in — verified live: without the filter, a cell containing nested `​```tableau`-looking content gets recursively re-rendered as a real table instead of inert code, and that recursively-produced HTML then gets silently dropped by remark-rehype's default (non-`allowDangerousHtml`) sanitization, leaving the cell empty. The filtered-replay approach inherits whatever's already attached to `this` (guaranteed to include a `Parser`, since `remarkTableau` only ever runs after parsing has already happened) while positively excluding remarkTableau regardless of attach order. No hardcoded `remark-gfm` or other syntax-plugin dependency.
- A cell's markdown failing to render fails the whole document (propagates as the existing `remark-tableau: ...` prefixed error), not a silent per-cell fallback.
- The main transform is `async`; `unist-util-visit`'s visitor stays synchronous (it doesn't support async callbacks) — collect matching `code` nodes first, process them afterward in a `for...of` loop with `await`.
- **This changes existing test expectations beyond just async-ifying them**: rendering cell content as Markdown means even simple text gets wrapped in a block element (e.g. cell content `a` renders as `<p>a</p>`, not bare `a`) — this matches the reference implementation's own behavior (Pandoc's `md2ast` also produces block-level content per cell), not a regression to work around.

---

### Task 1: Core rendering implementation

**Files:**
- Modify: `src/index.ts`
- Modify: `package.json`
- Modify: `test/index.test.ts`

**Interfaces:**
- Produces: `remarkTableau` (default export, unchanged signature/name) — now an `async` transform. Consumers must use `.process()`/`.run()` (async), not `.processSync()`/`.runSync()`.

- [ ] **Step 1: Write the failing tests**

Replace the full content of `test/index.test.ts` with:

```ts
import { describe, expect, it } from "vitest"
import { unified } from "unified"
import remarkParse from "remark-parse"
import { visit } from "unist-util-visit"
import type { Plugin } from "unified"
import remarkTableau from "../src/index.js"

async function run(markdown: string) {
  const processor = unified().use(remarkParse).use(remarkTableau)
  return processor.run(processor.parse(markdown))
}

describe("remark-tableau", () => {
  it("converts a tableau code block into an html node, rendering cell content as markdown", async () => {
    const tree = await run("```tableau\na|b\nc|d\n```\n")
    const node = tree.children[0] as any
    expect(node.type).toBe("html")
    expect(node.value).toContain("<table")
    expect(node.value).toContain("<td><p>a</p></td>")
    expect(node.value).toContain("<td><p>d</p></td>")
  })

  it("renders inline markdown emphasis inside a cell", async () => {
    const tree = await run("```tableau\n_hello_|world\n```\n")
    const node = tree.children[0] as any
    expect(node.value).toContain("<td><p><em>hello</em></p></td>")
  })

  it("leaves non-tableau code blocks untouched", async () => {
    const tree = await run("```js\nconst x = 1\n```\n")
    const node = tree.children[0] as any
    expect(node.type).toBe("code")
    expect(node.lang).toBe("js")
  })

  it("converts multiple tableau blocks in the same document, rendering each independently", async () => {
    const tree = await run("```tableau\na|b\n```\n\n```tableau\nc|d\n```\n")
    const first = (tree.children[0] as any).value
    const second = (tree.children[1] as any).value
    expect(first).toContain("<td><p>a</p></td>")
    expect(second).toContain("<td><p>c</p></td>")
  })

  it("renders multiple different cells in the same table independently", async () => {
    const tree = await run("```tableau\n_a_|**b**\nc|`d`\n```\n")
    const node = tree.children[0] as any
    expect(node.value).toContain("<td><p><em>a</em></p></td>")
    expect(node.value).toContain("<td><p><strong>b</strong></p></td>")
    expect(node.value).toContain("<td><p>c</p></td>")
    expect(node.value).toContain("<td><p><code>d</code></p></td>")
  })

  it("throws a descriptive error on a malformed tableau block", async () => {
    const markdown = "```tableau\na|b\n===\n===\n```\n"
    // The block's opening fence is on line 1, and the thrown error reports
    // the code block's starting line (per spec), not the specific line
    // within it where the parser detected the problem.
    await expect(run(markdown)).rejects.toThrowError(/^remark-tableau: .+\(.*:1\)$/)
  })

  it("does not recursively process a nested tableau-looking block inside cell content", async () => {
    // The outer fence uses tildes, not backticks: CommonMark closes a
    // fenced code block at the first matching bare closing fence, so an
    // outer ```tableau fence would close prematurely at the inner
    // block's closing ``` (before reaching the real end of the outer
    // block) rather than nesting correctly. Tildes and backticks don't
    // interfere with each other, so this reproduces genuine nesting.
    const markdown = [
      "~~~tableau",
      "a|b",
      "col2 {{",
      "```tableau",
      "x|y",
      "```",
      "}}",
      "~~~",
      "",
    ].join("\n")
    const tree = await run(markdown)
    const node = tree.children[0] as any
    // The inner fenced block must render as an ordinary, inert code block
    // (proving the cell sub-pipeline genuinely excludes remarkTableau) --
    // not get converted into a second, nested <table>.
    expect(node.value).toContain('class="language-tableau"')
    const tableCount = (node.value.match(/<table\b/g) || []).length
    expect(tableCount).toBe(1)
  })

  it("fails the whole document if rendering a cell's markdown throws", async () => {
    const throwing: Plugin = () => (tree) => {
      visit(tree, "text", (node: any) => {
        if (node.value.includes("TRIGGER_ERROR")) {
          throw new Error("boom")
        }
      })
    }
    const processor = unified().use(remarkParse).use(throwing).use(remarkTableau)
    const markdown = "```tableau\nTRIGGER_ERROR|b\n```\n"
    await expect(processor.run(processor.parse(markdown))).rejects.toThrowError(/remark-tableau: .*boom/)
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run test/index.test.ts`
Expected: FAIL. The current implementation is synchronous and doesn't touch `<tableau-md>` markers at all, so every test expecting `<p>`-wrapped rendered content fails; the malformed-block and reentrancy/error tests exercise behavior (`rejects`, the nested-block guard, the throwing-plugin propagation) that doesn't exist yet either.

- [ ] **Step 3: Update `src/index.ts`**

Replace the full content with:

```ts
import { unified } from "unified"
import { visit } from "unist-util-visit"
import { tableau, generate } from "ts-tableau"
import remarkRehype from "remark-rehype"
import rehypeStringify from "rehype-stringify"
import type { Plugin, Processor } from "unified"
import type { Root, Code, Html } from "mdast"

const LANGUAGE = "tableau"
const TABLEAU_MD_RE = /<tableau-md>([\s\S]*?)<\/tableau-md>/g

function unescapeMarkdown(text: string): string {
  return text
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
}

const remarkTableau: Plugin<[], Root> = function (this: Processor) {
  // Replay every plugin already queued on the outer processor onto a
  // fresh one, except remarkTableau itself. this.attachers is the same
  // field unified's own Processor.prototype.copy() reads to implement
  // this()-cloning -- but this() itself doesn't work here: by the time
  // an attacher's own body runs (during .freeze(), which iterates the
  // already-complete attachers array), its own entry is unavoidably
  // already in the list, so this() would clone remarkTableau right back
  // in. Filtering by identity is what actually excludes it.
  const cellProcessor = unified()
  for (const [attacher, ...params] of this.attachers) {
    if (attacher !== remarkTableau) cellProcessor.use(attacher, ...params)
  }
  cellProcessor.use(remarkRehype).use(rehypeStringify)

  async function renderMarkers(html: string): Promise<string> {
    const matches = Array.from(html.matchAll(TABLEAU_MD_RE))
    if (matches.length === 0) return html

    const rendered = await Promise.all(
      matches.map(async (m) =>
        String(await cellProcessor.process(unescapeMarkdown(m[1])))
      )
    )

    let result = ""
    let lastIndex = 0
    matches.forEach((m, i) => {
      result += html.slice(lastIndex, m.index)
      result += rendered[i]
      lastIndex = m.index! + m[0].length
    })
    result += html.slice(lastIndex)
    return result
  }

  return async (tree, file) => {
    const targets: { node: Code; index: number; parent: Root }[] = []
    visit(tree, "code", (node, index, parent) => {
      if (node.lang !== LANGUAGE || !parent || index === null || index === undefined) return
      targets.push({ node, index, parent: parent as Root })
    })

    for (const { node, index, parent } of targets) {
      let value: string
      try {
        const table = tableau(node.value.split("\n"))
        const html = generate(table).join("\n")
        value = await renderMarkers(html)
      } catch (err) {
        const line = node.position?.start.line
        throw new Error(`remark-tableau: ${err} (${file.path ?? "<unknown>"}:${line})`)
      }
      const htmlNode: Html = { type: "html", value, position: node.position }
      parent.children[index] = htmlNode
    }
  }
}

export default remarkTableau
```

- [ ] **Step 4: Update `package.json` dependencies**

Move `remark-rehype` and `rehype-stringify` from `devDependencies` to `dependencies` (they're used at runtime by the plugin now, not just in tests). Change the `dependencies`/`devDependencies` blocks from:

```json
  "dependencies": {
    "@types/mdast": "^4.0.4",
    "ts-tableau": "github:pragdave/ts-tableau",
    "unified": "^11.0.5",
    "unist-util-visit": "^5.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "rehype-raw": "^7.0.0",
    "rehype-stringify": "^10.0.1",
    "remark-parse": "^11.0.0",
    "remark-rehype": "^11.1.1",
    "typescript": "^5.6.2",
    "vitest": "^2.1.4"
  }
```

to:

```json
  "dependencies": {
    "@types/mdast": "^4.0.4",
    "rehype-stringify": "^10.0.1",
    "remark-rehype": "^11.1.1",
    "ts-tableau": "github:pragdave/ts-tableau",
    "unified": "^11.0.5",
    "unist-util-visit": "^5.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "rehype-raw": "^7.0.0",
    "remark-parse": "^11.0.0",
    "typescript": "^5.6.2",
    "vitest": "^2.1.4"
  }
```

Run `npm install` after this change so the lockfile reflects the moved dependencies.

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest run test/index.test.ts`
Expected: `Test Files 1 passed`, `Tests 8 passed`.

- [ ] **Step 6: Run the full test suite (including the not-yet-updated integration test) to see current state**

Run: `npx vitest run`
Expected: `test/integration.test.ts` FAILS at this point — its assertions still expect bare `<td>a</td>` content, not `<td><p>a</p></td>`. This is expected and will be fixed in Task 2; don't fix it in this task.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts package.json package-lock.json test/index.test.ts
git commit -m "$(cat <<'EOF'
Render Markdown inside <tableau-md> cell content

remarkTableau's attacher is now a regular function (not an arrow
function) so it can use `this` -- bound by unified to the processor
it's attached to -- to build a cell-content sub-pipeline by replaying
this.attachers onto a fresh unified() processor, explicitly excluding
remarkTableau itself by function-reference identity. This inherits
whatever remark-syntax plugins (GFM, math, anything) the consumer
already attached before remarkTableau in their own pipeline, with no
hardcoded dependency on any of them, while positively excluding
remarkTableau so a cell containing nested tableau-looking content
can't recurse back into this plugin.

The main transform is now async: it extracts every <tableau-md>
marker from the generated HTML via regex (safe because
ts-tableau's escaping guarantees escaped content can never contain a
literal '<'), unescapes and renders each one's Markdown, and splices
the result back in place of the marker before wrapping the whole
thing in the mdast html node, same as before.

This changes rendered output shape, not just adding markdown support:
even simple cell text like "a" now renders as "<p>a</p>", matching
how the reference Quarto/Pandoc implementation already renders table
cells as block-level content, not a regression.

Existing tests updated for the new async API (processor.run(), not
runSync()) and the new rendered-content shape; new tests cover inline
emphasis, multi-cell independence, the malformed-block error path
under async, reentrancy safety (a cell containing literal fenced
tableau-looking text doesn't get processed as a nested table), and
a cell markdown render failure propagating as a document-level error.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Lq7q2yHKdwk7ZbqhpC5DHh
EOF
)"
```

---

### Task 2: Integration test, GFM inheritance proof, and documentation

**Files:**
- Modify: `test/integration.test.ts`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: `remarkTableau` from Task 1, unchanged export shape.

- [ ] **Step 1: Add `remark-gfm` as a devDependency**

In `package.json`, add `"remark-gfm": "^4.0.0"` to `devDependencies` (alphabetically, between `rehype-raw` and `remark-parse`):

```json
  "devDependencies": {
    "@types/node": "^22.0.0",
    "rehype-raw": "^7.0.0",
    "remark-gfm": "^4.0.0",
    "remark-parse": "^11.0.0",
    "typescript": "^5.6.2",
    "vitest": "^2.1.4"
  }
```

Run `npm install` afterward.

- [ ] **Step 2: Write the failing/updated tests**

Replace the full content of `test/integration.test.ts` with:

```ts
import { describe, expect, it } from "vitest"
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import remarkRehype from "remark-rehype"
import rehypeRaw from "rehype-raw"
import rehypeStringify from "rehype-stringify"
import remarkTableau from "../src/index.js"

describe("remark-tableau integration", () => {
  it("renders a tableau block to HTML through the full remark/rehype pipeline", async () => {
    const markdown = [
      "# Heading",
      "",
      "```tableau",
      "a|b",
      "c|d",
      "```",
      "",
      "Some text after.",
      "",
    ].join("\n")

    const file = await unified()
      .use(remarkParse)
      .use(remarkTableau)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeRaw)
      .use(rehypeStringify)
      .process(markdown)

    const html = String(file)
    expect(html).toContain("<h1>Heading</h1>")
    expect(html).toContain('<table class="tableau')
    expect(html).toContain("<td><p>a</p></td>")
    expect(html).toContain("<td><p>d</p></td>")
    expect(html).toContain("<p>Some text after.</p>")
  })

  it("cell content renders as real markdown, including GFM syntax inherited from the outer pipeline", async () => {
    const markdown = [
      "```tableau",
      "_emphasis_|~~strikethrough~~",
      "```",
      "",
    ].join("\n")

    const file = await unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkTableau)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeRaw)
      .use(rehypeStringify)
      .process(markdown)

    const html = String(file)
    expect(html).toContain("<em>emphasis</em>")
    expect(html).toContain("<del>strikethrough</del>")
  })
})
```

- [ ] **Step 3: Run the tests and verify they pass**

Run: `npx vitest run`
Expected: all tests across both files pass.

- [ ] **Step 4: Update `README.md`**

Change the "Usage" section's intro paragraph from:

```md
`remark-tableau` replaces each `tableau` code block with a raw HTML node. For that HTML to survive into the final output, your pipeline must allow dangerous HTML through `remark-rehype` and then re-parse it with `rehype-raw`:
```

to:

```md
`remark-tableau` replaces each `tableau` code block with a raw HTML node, and renders the Markdown inside every cell along the way (using a sub-pipeline that automatically inherits any remark-syntax plugins -- GFM, math, footnotes, anything -- already attached to your own pipeline *before* `remarkTableau`; attach syntax plugins earlier in the chain if you want them to apply inside table cells too). For the generated HTML to survive into the final output, your pipeline must allow dangerous HTML through `remark-rehype` and then re-parse it with `rehype-raw`:
```

After the existing code example and its following paragraph (the one starting "Without `{ allowDangerousHtml: true }`..."), add:

```md
Because rendering cell Markdown is asynchronous, use `.process()` (as in the example above) or `.run()` -- not `.processSync()` / `.runSync()`.
```

Change the "Security" section from:

```md
## Security

Cell content is emitted as raw, unescaped HTML by the underlying `ts-tableau` library (the same behavior as the Quarto/Pandoc tableau extension this plugin mirrors). If you're processing untrusted Markdown, run [`rehype-sanitize`](https://github.com/rehypejs/rehype-sanitize) after this plugin in your pipeline.
```

to:

```md
## Security

Cell content is rendered as real Markdown, the same as the rest of your document. If you're processing untrusted Markdown, run [`rehype-sanitize`](https://github.com/rehypejs/rehype-sanitize) after this plugin in your pipeline -- the same advice that already applies to the rest of a Markdown document applies equally to table cells.
```

- [ ] **Step 5: Run the full test suite one more time to confirm nothing broke**

Run: `npx vitest run`
Expected: all tests pass (same count as Step 3 -- this step only touched documentation).

- [ ] **Step 6: Commit**

```bash
git add test/integration.test.ts package.json package-lock.json README.md
git commit -m "$(cat <<'EOF'
Prove GFM inheritance end-to-end; update docs for rendered cells

Adds an integration test demonstrating that a syntax plugin
(remark-gfm) attached to the outer pipeline before remarkTableau is
automatically available inside cell content too -- confirming the
this()-cloning mechanism works in a real pipeline, not just in
isolation.

Updates the existing integration test's assertions for the new
<p>-wrapped rendered-cell output shape.

README: documents the plugin-ordering requirement (attach syntax
plugins before remarkTableau for them to apply inside cells), the
async (.process()/.run(), not *Sync()) requirement, and updates the
Security section now that cell content is genuinely rendered
Markdown rather than raw passthrough.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Lq7q2yHKdwk7ZbqhpC5DHh
EOF
)"
```
