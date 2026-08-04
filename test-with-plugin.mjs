import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkTableau from "./dist/index.js"

async function run(markdown) {
  console.log("Creating processor...")
  const processor = unified().use(remarkParse).use(remarkTableau)
  console.log("Processor created")
  console.log("Parsing...")
  const ast = processor.parse(markdown)
  console.log("AST parsed:", ast.children.length, "children")
  console.log("Running...")
  const result = await processor.run(ast)
  console.log("Run complete")
  return result
}

console.log("Starting test...")
const tree = await run("```tableau\na|b\n```\n")
console.log("Test complete")
console.log("Result tree:", tree.children[0])
