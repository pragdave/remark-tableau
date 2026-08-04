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

const remarkTableau: Plugin<[], Root> = function (this: Processor) {
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
