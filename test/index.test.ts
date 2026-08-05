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

  it("renders an inline error for a malformed tableau block instead of failing the document", async () => {
    const markdown = "```tableau\na|b\n===\n===\n```\n"
    const tree = await run(markdown)
    const node = tree.children[0] as any
    expect(node.type).toBe("html")
    expect(node.value).toContain("remark-tableau:")
    // The block's opening fence is on line 1, and the reported error names
    // the code block's starting line (per spec), not the specific line
    // within it where the parser detected the problem.
    expect(node.value).toMatch(/\(.*:1\)/)
  })

  it("does not let one table's error block other tables in the same document", async () => {
    const markdown = [
      "```tableau",
      "a|b",
      "```",
      "",
      "```tableau",
      "a|b",
      "===",
      "===",
      "```",
      "",
      "```tableau",
      "c|d",
      "```",
      "",
    ].join("\n")
    const tree = await run(markdown)
    const [first, second, third] = tree.children as any[]

    expect(first.value).toContain("<td><p>a</p></td>")
    expect(second.value).toContain("remark-tableau:")
    expect(third.value).toContain("<td><p>c</p></td>")
  })

  it("does not recursively process a nested tableau-looking block inside cell content", async () => {
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

  it("renders an inline error, scoped to that table, if rendering a cell's markdown throws", async () => {
    const throwing: Plugin = () => (tree) => {
      visit(tree, "text", (node: any) => {
        if (node.value.includes("TRIGGER_ERROR")) {
          throw new Error("boom")
        }
      })
    }
    const processor = unified().use(remarkParse).use(throwing).use(remarkTableau)
    const markdown = "```tableau\nTRIGGER_ERROR|b\n```\n\n```tableau\nc|d\n```\n"
    const tree = await processor.run(processor.parse(markdown))
    const [first, second] = tree.children as any[]

    expect(first.value).toMatch(/remark-tableau: .*boom/)
    expect(second.value).toContain("<td><p>c</p></td>")
  })

  it("does not replay plugins attached after remarkTableau into the cell sub-pipeline", async () => {
    const marker: Plugin = () => (tree) => {
      visit(tree, "text", (node: any) => {
        node.value += "!!MARK!!"
      })
    }
    const processor = unified().use(remarkParse).use(remarkTableau).use(marker)
    const markdown = "hello\n\n```tableau\n_a_|b\n```\n"
    const tree = await processor.run(processor.parse(markdown))

    // Positive control: the marker plugin does run on the outer document,
    // proving it would show up in cell output too if it leaked in.
    const paragraph = tree.children[0] as any
    expect(paragraph.children[0].value).toContain("!!MARK!!")

    // But it must not have been replayed into the cell sub-pipeline: a
    // plugin queued after remarkTableau should never touch cell rendering.
    const tableNode = tree.children[1] as any
    expect(tableNode.value).not.toContain("!!MARK!!")
  })
})
