import { describe, expect, it } from 'vitest'
import { markdownToHtml } from './markdown'

describe('markdownToHtml', () => {
  it('returns an empty paragraph for empty input', () => {
    expect(markdownToHtml('')).toBe('<p></p>')
  })

  it('normalizes line endings and joins paragraph lines', () => {
    expect(markdownToHtml('first\r\nsecond\rthird')).toBe('<p>first second third</p>')
  })

  it('escapes HTML and converts inline formatting', () => {
    expect(markdownToHtml(`<&> "quotes" 'single' **bold** __strong__ *italic* _em_ ~~gone~~`)).toBe(
      '<p>&lt;&amp;&gt; &quot;quotes&quot; &#39;single&#39; <strong>bold</strong> <strong>strong</strong> <em>italic</em> <em>em</em> <s>gone</s></p>'
    )
  })

  it('protects inline code from formatting conversion', () => {
    expect(markdownToHtml('Use `**literal**` and `code`')).toBe(
      '<p>Use <code>**literal**</code> and <code>code</code></p>'
    )
  })

  it('drops unknown internal code placeholders', () => {
    expect(markdownToHtml('before @@CODE99@@ after')).toBe('<p>before  after</p>')
  })

  it('converts safe links and leaves unsafe links as text', () => {
    expect(
      markdownToHtml(
        '[Web](https://example.com/path) [Mail](mailto:user@example.com) [Bad](javascript:alert(1))'
      )
    ).toBe(
      '<p><a href="https://example.com/path" rel="noopener noreferrer">Web</a> <a href="mailto:user@example.com" rel="noopener noreferrer">Mail</a> [Bad](javascript:alert(1))</p>'
    )
  })

  it('renders headings, rules, and quotes', () => {
    expect(markdownToHtml('# One\n## Two\n### Three\n---\n> quoted **text**')).toBe(
      '<h1>One</h1><h2>Two</h2><h3>Three</h3><hr><blockquote><p>quoted <strong>text</strong></p></blockquote>'
    )
  })

  it('renders and switches between unordered and ordered lists', () => {
    expect(markdownToHtml('- one\n* two\n1. first\n2) second\nafter')).toBe(
      '<ul><li><p>one</p></li><li><p>two</p></li></ul><ol><li><p>first</p></li><li><p>second</p></li></ol><p>after</p>'
    )
  })

  it('closes a list at blank lines and end of input', () => {
    expect(markdownToHtml('- one\n\n- two')).toBe(
      '<ul><li><p>one</p></li></ul><ul><li><p>two</p></li></ul>'
    )
  })

  it('renders fenced and unclosed code blocks with escaped content', () => {
    expect(markdownToHtml('before\n```ts\n<a>&\n```\nafter')).toBe(
      '<p>before</p><pre><code>&lt;a&gt;&amp;</code></pre><p>after</p>'
    )
    expect(markdownToHtml('```\nunclosed')).toBe('<pre><code>unclosed</code></pre>')
  })

  it('flushes paragraphs and lists before block constructs', () => {
    expect(markdownToHtml('paragraph\n# heading\n- item\n> quote\ntext\n```\ncode\n```')).toBe(
      '<p>paragraph</p><h1>heading</h1><ul><li><p>item</p></li></ul><blockquote><p>quote</p></blockquote><p>text</p><pre><code>code</code></pre>'
    )
  })
})
