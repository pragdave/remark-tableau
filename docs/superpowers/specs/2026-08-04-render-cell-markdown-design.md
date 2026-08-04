# Render `<tableau-md>` cell content design

## Purpose

`ts-tableau` deliberately doesn't render Markdown inside table cells —
it wraps each cell's (HTML-entity-escaped) content in
`<tableau-md>...</tableau-md>` and documents that finding, rendering, and
unwrapping those elements is a downstream consumer's job (see
`ts-tableau`'s README, "Cell Content" section). `remark-tableau` is that
consumer. This spec closes that loop: it makes `remarkTableau` actually
render the Markdown inside every `<tableau-md>` marker, so cell content
like `_emphasis_`, lists, and GFM syntax produce real HTML instead of
literal source text.

Confirmed live earlier in the session that predates this plugin: without
this, `_Alpha Ursae_` in a cell renders as the literal underscored text,
not `<em>`.

## Decisions

- **No new plugin, no new package surface.** This is implemented entirely
  inside the existing `remarkTableau` (`src/index.ts`), not a separate
  rehype-level plugin. `ts-tableau`'s escaping contract makes this safe:
  since `escape_markdown()` escapes `&`/`<`/`>`, the escaped content
  inside a `<tableau-md>` element can never contain a literal `<`
  character, so a regex can find and extract every marker from the raw
  HTML string unambiguously — no HTML parsing needed, and no need to wait
  for `rehype-raw` to run on a separate downstream pass.
- **The cell-content sub-pipeline inherits the consumer's own remark
  plugins automatically, by replaying `this.attachers` — not a hardcoded
  plugin list, and not `this()`-cloning.** Inside a plugin's attacher
  function, `this` is bound to the processor being configured, and
  `this.attachers` is the array of `[plugin, ...params]` tuples every
  `.use()` call on that processor has queued so far (this is the same
  field unified's own `Processor.prototype.copy()` reads to implement
  `this()`-cloning — not a private workaround, but unified's own
  documented mechanism, used the same way).
  `remarkTableau`'s attacher builds a fresh `unified()` processor and
  replays every entry in `this.attachers` onto it via `.use(attacher,
  ...params)` — **except the entry whose plugin is `remarkTableau`
  itself** (filtered by function-reference identity: `attacher !==
  remarkTableau`) — then adds `remarkRehype`/`rehypeStringify` on top.
  This automatically picks up whatever remark-syntax plugins (GFM, math,
  frontmatter, footnotes, anything) the consumer already attached
  *before* `remarkTableau` in their own `.use()` chain, with zero
  explicit dependency on any of them, while positively excluding
  `remarkTableau` itself regardless of where in the pipeline it was
  attached. This also means `remark-parse` doesn't need to be an explicit
  dependency of this plugin either — by the time `remarkTableau`'s
  attacher runs, a `Parser` (`remark-parse` or equivalent) is
  *guaranteed* to already be attached to `this`, since `remarkTableau`
  only ever receives a valid mdast tree to visit because parsing already
  happened.
  - **Corrected understanding of unified's lifecycle (this invalidated an
    earlier draft of this spec):** `.use()` only *queues* a plugin by
    pushing onto `this.attachers`; attacher functions don't run until
    `.freeze()` (triggered lazily by the first `.parse()`/`.run()`/
    `.process()` call), which iterates the *already-complete*
    `this.attachers` array in order and calls each attacher with `this`
    bound to the *same* processor object. That means by the time
    `remarkTableau`'s own attacher body executes at all, its own entry is
    unavoidably already present in `this.attachers` — there is no point
    in its lifecycle, early or late in its attacher body, where `this()`
    (or any clone of `this.attachers` taken as-is) excludes it. The fix
    is exclusion by filtering, not by timing.
  - **Caveat, corrected during the final whole-branch review**: an
    earlier draft of this bullet claimed plugins attached *after*
    `remarkTableau` "don't exist yet in `this.attachers` at the point
    `remarkTableau`'s attacher runs" — that's wrong for the same reason
    the `this()` claim above was wrong. `.freeze()` only starts iterating
    *after* every `.use()` call has already run, so by the time
    `remarkTableau`'s attacher body executes, `this.attachers` already
    holds the *entire* chain, including entries added after it. A naive
    filter that only excludes `remarkTableau`'s own entry (`attacher !==
    remarkTableau`) therefore *also* replays every later-attached plugin
    into the cell sub-pipeline — verified live: a `rehype`-side plugin
    attached after `remarkTableau` got applied twice to cell content (once
    inside the cell sub-pipeline, once again on the outer document). The
    fix is to stop replaying at the first entry matching `remarkTableau`
    (`break` instead of a bare skip), which correctly excludes both
    `remarkTableau` itself and everything queued after it, since
    `this.attachers` preserves `.use()` call order. This makes "attach
    remarkTableau after your syntax plugins" a real requirement, not just
    a convention: plugins attached after it are now genuinely excluded
    from the cell sub-pipeline, matching the README.
  - This directly replaces the earlier "should the sub-pipeline be
    configurable via a plugin option" question — it's configurable, just
    implicitly through normal pipeline composition, no new options API
    needed.
- **No reentrancy risk, by construction.** The sub-pipeline is built by
  replaying `this.attachers` with `remarkTableau` itself explicitly
  filtered out by identity, so it can never contain `remarkTableau`
  regardless of when or where in the chain it was attached — a cell
  containing something that looks like nested table markdown can't
  recurse back into this plugin. Verified directly: a cell whose content
  is itself a fenced `​```tableau` block renders as an inert
  `<pre><code class="language-tableau">`, not a second nested `<table>`.
- **A cell's markdown failing to render fails the whole document**, with
  a clear error — matching how a malformed `​```tableau` block already
  behaves (no silent per-cell fallback to raw text).
- **`remarkTableau`'s transform becomes `async`.** `unist-util-visit`
  doesn't support async visitors, so the transform collects every
  matching `code` node first via a normal synchronous `visit`, then
  processes them afterward in a `for...of` loop with `await`. Existing
  consumers already call `.process()` (confirmed in the current
  integration test), so this isn't a compatibility break — but it's
  worth a README note that `.processSync()` won't work with this plugin.

## Architecture

`src/index.ts` changes from an arrow-function attacher to a regular
`function` (arrow functions don't bind `this` from the call site, and
reading `this.attachers` requires the real bound `this`):

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
  // fresh one, except remarkTableau itself -- this.attachers is the same
  // field unified's own Processor.prototype.copy() reads to implement
  // this()-cloning. We can't use this() directly: by the time an
  // attacher's own body runs (during .freeze(), which iterates the
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

**Unescaping order matters, mirroring `escape_markdown`'s escaping order
in reverse.** `ts-tableau` escapes `&` first, then `<`, then `>` — so a
literal `&lt;` in the original source (someone typing those 4 characters
to display the text "&lt;", not an actual `<`) gets escaped to `&amp;lt;`.
Unescaping must reverse the order (`&gt;`→`>` first, `&lt;`→`<` second,
`&amp;`→`&` last) to recover the original literal text correctly rather
than corrupting it — verified by hand-tracing this exact case:
`&amp;lt;` → (no `&gt;` match) → (no `&lt;` match, since the leading `&`
was already consumed by `&amp;` and doesn't reappear) → `&amp;`→`&` gives
back `&lt;`, correct.

## Dependencies

- `remark-rehype`, `rehype-stringify` move from `devDependencies` to
  `dependencies` — used at runtime by the plugin now, not just in tests.
- `remark-parse` stays a `devDependency` — only needed for this package's
  own tests; the plugin itself never imports it, relying on the consumer
  having already attached a parser (guaranteed, per the Decisions
  section above).
- No new dependency on `remark-gfm` or any other syntax plugin — that's
  the whole point of the `this()`-cloning approach.

## Testing

- Unit-level (extending `test/index.test.ts`): a cell containing
  `_emphasis_` renders as `<em>emphasis</em>` inside the resulting `html`
  node's value, not literal underscores. A cell with no `<tableau-md>`
  markers (shouldn't happen in practice, but a degenerate/defensive case)
  passes through `renderMarkers` unchanged. A table with multiple cells
  each containing different Markdown all render correctly and
  independently (proving the multi-marker extraction/splice logic is
  correct, not just a single-marker happy path).
- Reentrancy: a cell whose content is itself a ` ```tableau ` fenced code
  block (as literal text, e.g. someone demonstrating tableau syntax
  inside a tableau cell) must NOT be processed as a nested table — it
  should render as an inert code block in the output, proving the cloned
  sub-pipeline genuinely excludes `remarkTableau` itself.
- Integration-level (extending `test/integration.test.ts`): register a
  syntax plugin (e.g. `remark-gfm`, already a natural devDependency to
  add for this test) on the *outer* pipeline before `remarkTableau`, put
  GFM-specific syntax (e.g. `~~strikethrough~~` or a task list) inside a
  cell, and confirm it renders correctly — proving the inheritance
  mechanism actually works end-to-end, not just in isolation.
- Error handling: a cell containing Markdown that causes the sub-pipeline
  to throw (hard to construct with only well-behaved plugins attached —
  may need a minimal throwing test double/plugin) fails the whole
  `process()` call with a clear error, matching a malformed `​```tableau`
  block's existing behavior.

## Out of scope

- Configurability of the cell sub-pipeline beyond what's automatically
  inherited (no explicit options parameter) — see Decisions.
- Any change to `ts-tableau` itself — `<tableau-md>`'s wire format and
  escaping contract are unchanged; this spec is entirely about how
  `remark-tableau` consumes them.
- Updating the ported guide (`ts-tableau`'s `docs/guide/tableau-guide.qmd`)
  to actually be rendered through this pipeline — a separate, later step
  once this ships, not part of implementing the rendering itself.
