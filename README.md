# remark-tableau

A [remark](https://github.com/remarkjs/remark) plugin that renders ` ```tableau ` fenced code blocks (using the [`ts-tableau`](https://github.com/pragdave/ts-tableau) library) as HTML tables, for any remark-based Markdown pipeline.

## Install

```sh
npm install github:pragdave/remark-tableau
```

## Usage

`remark-tableau` replaces each `tableau` code block with a raw HTML node, and renders the Markdown inside every cell along the way (using a sub-pipeline that automatically inherits any remark-syntax plugins -- GFM, math, footnotes, anything -- already attached to your own pipeline *before* `remarkTableau`; attach syntax plugins earlier in the chain if you want them to apply inside table cells too). For the generated HTML to survive into the final output, your pipeline must allow dangerous HTML through `remark-rehype` and then re-parse it with `rehype-raw`:

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

Because rendering cell Markdown is asynchronous, use `.process()` (as in the example above) or `.run()` -- not `.processSync()` / `.runSync()`.

## Security

Cell content is rendered as real Markdown, the same as the rest of your document. If you're processing untrusted Markdown, run [`rehype-sanitize`](https://github.com/rehypejs/rehype-sanitize) after this plugin in your pipeline -- the same advice that already applies to the rest of a Markdown document applies equally to table cells.

Raw HTML written literally inside cell Markdown source is dropped by default: the cell sub-pipeline doesn't enable `allowDangerousHtml`, and since plugins queued after `remarkTableau` (including a consumer's own `remark-rehype, { allowDangerousHtml: true }` if attached there) aren't replayed into cell rendering, that option can't leak into cells either.
