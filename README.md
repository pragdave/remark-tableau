# remark-tableau

A [remark](https://github.com/remarkjs/remark) plugin that renders ` ```tableau ` fenced code blocks (using the [`ts-tableau`](https://github.com/pragdave/ts-tableau) library) as HTML tables, for any remark-based Markdown pipeline.

## Install

```sh
npm install github:pragdave/remark-tableau
```

## Usage

`remark-tableau` replaces each `tableau` code block with a raw HTML node. For that HTML to survive into the final output, your pipeline must allow dangerous HTML through `remark-rehype` and then re-parse it with `rehype-raw`:

```js
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import rehypeRaw from "rehype-raw"
import rehypeStringify from "rehype-stringify"
import remarkTableau from "remark-tableau"

const file = await unified()
  .use(remarkParse)
  .use(remarkTableau)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeStringify)
  .process(markdown)

console.log(String(file))
```

Without `{ allowDangerousHtml: true }` on `remark-rehype` and `rehype-raw` in the pipeline, the generated tables will be dropped or escaped instead of rendered.

## Security

Cell content is emitted as raw, unescaped HTML by the underlying `ts-tableau` library (the same behavior as the Quarto/Pandoc tableau extension this plugin mirrors). If you're processing untrusted Markdown, run [`rehype-sanitize`](https://github.com/rehypejs/rehype-sanitize) after this plugin in your pipeline.
