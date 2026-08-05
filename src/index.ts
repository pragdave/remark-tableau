import { visit } from "unist-util-visit"
import { tableau, generate } from "ts-tableau"
import { unified } from "unified"
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function errorHtml(message: string): string {
  return `<pre style="border:2px solid #c00;background:#fee;color:#900;padding:0.5rem 0.75rem;white-space:pre-wrap;">${escapeHtml(message)}</pre>`
}

const remarkTableau: Plugin<[], Root> = function (this: Processor) {
  const cellProcessor = unified()
  // Replay every plugin already queued on the outer processor onto a
  // fresh one, stopping at remarkTableau itself (and excluding
  // everything after it too, since this.attachers already holds the
  // complete chain by the time this attacher runs -- unified's
  // .freeze() only starts iterating after every .use() call has
  // completed). this.attachers is the same field unified's own
  // Processor.prototype.copy() reads to implement this()-cloning, but
  // this() itself doesn't work here: cloning this.attachers as-is would
  // include remarkTableau's own entry, since there's no point in its
  // lifecycle where that entry is absent from the array. Filtering with
  // break is what actually excludes it (and everything queued after
  // it).
  for (const [attacher, ...params] of this.attachers) {
    if (attacher === remarkTableau) break
    cellProcessor.use(attacher, ...params)
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
        // A table that fails to parse or render must not take the rest
        // of the document down with it: replace just this table with a
        // visible inline error and keep processing the others. The
        // failure is still surfaced -- both inline and as a non-fatal
        // VFile message -- just scoped to the one table that caused it.
        const line = node.position?.start.line
        const message = `remark-tableau: ${err} (${file.path ?? "<unknown>"}:${line})`
        file.message(message, node.position, "remark-tableau")
        value = errorHtml(message)
      }
      const htmlNode: Html = { type: "html", value, position: node.position }
      parent.children[index] = htmlNode
    }
  }
}

export default remarkTableau
