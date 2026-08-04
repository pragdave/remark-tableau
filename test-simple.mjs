import { unified } from "unified"
import remarkParse from "remark-parse"
import { tableau, generate } from "ts-tableau"
import remarkRehype from "remark-rehype"
import rehypeStringify from "rehype-stringify"

// Test the basic flow
const markdown = "```tableau\na|b\n```\n"

const processor = unified().use(remarkParse)
const ast = processor.parse(markdown)

console.log("Code node:", ast.children[0])

// Now test wrapping
const html = "<table><tr><td>a</td><td>b</td></tr></table>"
const wrapped = html.replace(/<td([^>]*)>([^<]*)<\/td>/g, (match, attrs, content) => {
  const escaped = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
  return `<td${attrs}><tableau-md>${escaped}</tableau-md></td>`
})

console.log("Wrapped HTML:", wrapped)

// Now test the marker rendering
const TABLEAU_MD_RE = /<tableau-md>([\s\S]*?)<\/tableau-md>/g
const matches = Array.from(wrapped.matchAll(TABLEAU_MD_RE))
console.log("Found", matches.length, "markers")

// Test rendering one marker
const cellProcessor = unified()
  .use(remarkParse)
  .use(remarkRehype)
  .use(rehypeStringify)

for (const m of matches) {
  console.log("Processing marker content:", m[1])
  const result = await cellProcessor.process(m[1])
  console.log("Result:", String(result))
}

console.log("Done!")
