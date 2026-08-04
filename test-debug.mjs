import { unified } from "unified"
import remarkParse from "remark-parse"

const testPlugin = function (options) {
  return (tree) => {
    console.log("Transform called")
  }
}

const testAttacherPlugin = function () {
  console.log("Plugin attacher called")
  console.log("this:", this)
  
  const clone = this()
  console.log("clone:", clone)
  
  return testPlugin()
}

const processor = unified()
  .use(remarkParse)
  .use(testAttacherPlugin)

const ast = processor.parse("test")
