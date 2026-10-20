import fs from 'node:fs'
import ts from 'typescript'

const dependencies = Object.fromEntries(await Promise.all([
  'unified', 'remark-parse', 'remark-gfm', 'remark-math', 'remark-rehype', 'remark-breaks',
  'rehype-sanitize', 'rehype-katex', 'rehype-stringify',
].map(async name => [name, await import(name)])))
const source = fs.readFileSync(new URL('../../src/lib/comment-markdown.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const module = { exports: {} }
Function('require', 'module', 'exports', code)(name => {
  if (!(name in dependencies)) throw new Error(`Unexpected Markdown dependency: ${name}`)
  return dependencies[name]
}, module, module.exports)

export const { commentMarkdownHtml, renderCommentMarkdown } = module.exports
