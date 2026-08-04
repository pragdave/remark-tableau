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
