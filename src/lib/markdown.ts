function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, '&#96;')
}

function inlineMarkdownToHtml(value: string) {
  let html = escapeHtml(value)
  const code: string[] = []

  html = html.replace(/`([^`]+)`/g, (_match, content: string) => {
    const index = code.push(`<code>${content}</code>`) - 1
    return `@@CODE${index}@@`
  })

  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
    (_match, text: string, href: string) => {
      return `<a href="${escapeAttribute(href)}" rel="noopener noreferrer">${text}</a>`
    }
  )
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>')
  html = html.replace(/~~([^~]+)~~/g, '<s>$1</s>')

  return html.replace(/@@CODE(\d+)@@/g, (_match, index: string) => code[Number(index)] ?? '')
}

function closeList(output: string[], listType: 'ul' | 'ol' | null) {
  if (listType) output.push(`</${listType}>`)
  return null
}

export function markdownToHtml(markdown: string) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const output: string[] = []
  let paragraph: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let codeBlock: string[] | null = null

  function flushParagraph() {
    if (paragraph.length === 0) return
    output.push(`<p>${inlineMarkdownToHtml(paragraph.join(' '))}</p>`)
    paragraph = []
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith('```')) {
      flushParagraph()
      listType = closeList(output, listType)

      if (codeBlock) {
        output.push(`<pre><code>${escapeHtml(codeBlock.join('\n'))}</code></pre>`)
        codeBlock = null
      } else {
        codeBlock = []
      }
      continue
    }

    if (codeBlock) {
      codeBlock.push(line)
      continue
    }

    if (!trimmed) {
      flushParagraph()
      listType = closeList(output, listType)
      continue
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      listType = closeList(output, listType)
      output.push(
        `<h${heading[1].length}>${inlineMarkdownToHtml(heading[2])}</h${heading[1].length}>`
      )
      continue
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph()
      listType = closeList(output, listType)
      output.push('<hr>')
      continue
    }

    const quote = trimmed.match(/^>\s?(.+)$/)
    if (quote) {
      flushParagraph()
      listType = closeList(output, listType)
      output.push(`<blockquote><p>${inlineMarkdownToHtml(quote[1])}</p></blockquote>`)
      continue
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/)
    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/)
    if (unordered || ordered) {
      flushParagraph()
      const nextType = unordered ? 'ul' : 'ol'
      if (listType !== nextType) {
        if (listType) output.push(`</${listType}>`)
        output.push(`<${nextType}>`)
        listType = nextType
      }
      output.push(`<li><p>${inlineMarkdownToHtml((unordered ?? ordered)![1])}</p></li>`)
      continue
    }

    listType = closeList(output, listType)
    paragraph.push(trimmed)
  }

  if (codeBlock) output.push(`<pre><code>${escapeHtml(codeBlock.join('\n'))}</code></pre>`)
  flushParagraph()
  if (listType) output.push(`</${listType}>`)

  return output.join('') || '<p></p>'
}
