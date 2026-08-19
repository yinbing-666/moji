import type { ReactNode } from 'react'

interface MarkdownReportProps {
  content: string
}

function inlineText(value: string) {
  const parts = value.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g)
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index} className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.9em] text-gray-700">{part.slice(1, -1)}</code>
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={index}>{part.slice(1, -1)}</em>
    }
    return <span key={index}>{part}</span>
  })
}

/** Render the fixed-format reports without injecting HTML into the WebView. */
export function MarkdownReport({ content }: MarkdownReportProps) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let paragraph: string[] = []
  let list: string[] = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push(<p key={`p-${blocks.length}`} className="whitespace-pre-wrap text-sm leading-7 text-gray-700">{inlineText(paragraph.join('\n'))}</p>)
    paragraph = []
  }
  const flushList = () => {
    if (list.length === 0) return
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="list-disc space-y-1.5 pl-5 text-sm leading-6 text-gray-700">
        {list.map((item, index) => <li key={`${item}-${index}`}>{inlineText(item)}</li>)}
      </ul>,
    )
    list = []
  }

  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed) {
      flushParagraph()
      flushList()
      return
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed)
    if (heading) {
      flushParagraph()
      flushList()
      const level = heading[1].length
      const className = level === 1
        ? 'text-xl font-semibold text-gray-900'
        : level === 2
          ? 'text-base font-semibold text-gray-900'
          : 'text-sm font-semibold text-gray-800'
      blocks.push(<h3 key={`h-${index}`} className={className}>{inlineText(heading[2])}</h3>)
      return
    }
    const bullet = /^[-*]\s+(.+)$/.exec(trimmed)
    if (bullet) {
      flushParagraph()
      list.push(bullet[1])
      return
    }
    if (/^---+$/.test(trimmed)) {
      flushParagraph()
      flushList()
      blocks.push(<hr key={`hr-${index}`} className="border-gray-200" />)
      return
    }
    paragraph.push(line)
  })
  flushParagraph()
  flushList()

  return <div className="space-y-4">{blocks.length > 0 ? blocks : <p className="text-sm text-gray-400">（报告暂无内容）</p>}</div>
}
