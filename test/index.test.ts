import { describe, expect, it } from "vitest"
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkTableau from "../src/index.js"

function run(markdown: string) {
  const processor = unified().use(remarkParse).use(remarkTableau)
  return processor.runSync(processor.parse(markdown))
}

describe("remark-tableau", () => {
  it("converts a tableau code block into an html node", () => {
    const tree = run("```tableau\na|b\nc|d\n```\n")
    const node = tree.children[0] as any
    expect(node.type).toBe("html")
    expect(node.value).toContain("<table")
    expect(node.value).toContain("<td>a</td>")
    expect(node.value).toContain("<td>d</td>")
  })

  it("leaves non-tableau code blocks untouched", () => {
    const tree = run("```js\nconst x = 1\n```\n")
    const node = tree.children[0] as any
    expect(node.type).toBe("code")
    expect(node.lang).toBe("js")
  })

  it("converts multiple tableau blocks in the same document", () => {
    const tree = run("```tableau\na|b\n```\n\n```tableau\nc|d\n```\n")
    expect((tree.children[0] as any).type).toBe("html")
    expect((tree.children[1] as any).type).toBe("html")
  })

  it("throws a descriptive error on a malformed tableau block", () => {
    const markdown = "```tableau\na|b\n===\n===\n```\n"
    expect(() => run(markdown)).toThrowError(/^remark-tableau: /)
  })
})
