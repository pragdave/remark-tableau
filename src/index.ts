import { visit } from "unist-util-visit"
import { tableau, generate } from "ts-tableau"
import type { Plugin } from "unified"
import type { Root, Html } from "mdast"

const LANGUAGE = "tableau"

const remarkTableau: Plugin<[], Root> = () => {
  return (tree, file) => {
    visit(tree, "code", (node, index, parent) => {
      if (node.lang !== LANGUAGE || !parent || index === undefined) return

      let value: string
      try {
        const table = tableau(node.value.split("\n"))
        value = generate(table).join("\n")
      } catch (err) {
        const line = node.position?.start.line
        throw new Error(`remark-tableau: ${err} (${file.path}:${line})`)
      }

      const htmlNode: Html = { type: "html", value }
      parent.children[index] = htmlNode
    })
  }
}

export default remarkTableau
