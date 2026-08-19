import type { ReactNode } from 'react'

interface MarkdownReportProps {
  content: string
}

type SectionTone = 'default' | 'summary' | 'action' | 'risk' | 'timeline'

interface ReportSection {
  title?: string
  level: number
  tone: SectionTone
  blocks: ReactNode[]
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

function sectionTone(title = ''): SectionTone {
  if (/概览|摘要|结论|关键结果|目标/.test(title)) return 'summary'
  if (/下一步|明日|后续|行动|待办/.test(title)) return 'action'
  if (/风险|问题|阻塞/.test(title)) return 'risk'
  if (/时间线|时间安排/.test(title)) return 'timeline'
  return 'default'
}

function sectionClassName(tone: SectionTone): string {
  switch (tone) {
    case 'summary': return 'border-brand-200 bg-brand-50/45'
    case 'action': return 'border-sky-100 bg-sky-50/45'
    case 'risk': return 'border-amber-200 bg-amber-50/45'
    case 'timeline': return 'border-gray-200 bg-gray-50/70'
    default: return 'border-gray-200/80 bg-surface'
  }
}

function headingClassName(level: number): string {
  if (level === 1) return 'text-2xl font-semibold text-gray-900'
  if (level === 2) return 'text-base font-semibold text-gray-900'
  return 'text-sm font-semibold text-gray-800'
}

/** Render reports with a small, safe Markdown subset and document-style sections. */
export function MarkdownReport({ content }: MarkdownReportProps) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const sections: ReportSection[] = [{ level: 0, tone: 'default', blocks: [] }]
  let paragraph: string[] = []
  let list: string[] = []

  const current = () => sections[sections.length - 1]
  const flushParagraph = () => {
    if (paragraph.length === 0) return
    current().blocks.push(
      <p key={`p-${current().blocks.length}`} className="whitespace-pre-wrap text-sm leading-7 text-gray-700">
        {inlineText(paragraph.join('\n'))}
      </p>,
    )
    paragraph = []
  }
  const flushList = () => {
    if (list.length === 0) return
    const actionList = current().tone === 'action'
    current().blocks.push(
      <ul key={`ul-${current().blocks.length}`} className={actionList ? 'space-y-2 text-sm leading-6 text-gray-700' : 'list-disc space-y-1.5 pl-5 text-sm leading-6 text-gray-700'}>
        {list.map((item, index) => (
          <li key={`${item}-${index}`} className={actionList ? 'flex gap-2.5' : undefined}>
            {actionList && <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />}
            <span>{inlineText(item)}</span>
          </li>
        ))}
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
      const title = heading[2]
      sections.push({ title, level, tone: sectionTone(title), blocks: [] })
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
      current().blocks.push(<hr key={`hr-${index}`} className="border-gray-200" />)
      return
    }
    flushList()
    paragraph.push(line)
  })
  flushParagraph()
  flushList()

  const visibleSections = sections.filter(section => section.title || section.blocks.length > 0)
  if (visibleSections.length === 0) return <p className="text-sm text-gray-400">（报告暂无内容）</p>

  return (
    <article className="space-y-4">
      {visibleSections.map((section, index) => {
        const title = section.title
        if (!title) return <div key={`intro-${index}`} className="space-y-3">{section.blocks}</div>
        const isTitle = section.level === 1
        return (
          <section key={`${title}-${index}`} className={isTitle ? 'pb-2' : `rounded-lg border p-4 ${sectionClassName(section.tone)}`}>
            <div className={isTitle ? 'mb-3' : 'mb-3 flex items-center gap-2'}>
              {!isTitle && <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${section.tone === 'risk' ? 'bg-amber-500' : section.tone === 'action' ? 'bg-sky-500' : section.tone === 'summary' ? 'bg-brand-500' : 'bg-gray-400'}`} />}
              <h3 className={headingClassName(section.level)}>{inlineText(title)}</h3>
            </div>
            {section.blocks.length > 0 && <div className="space-y-3">{section.blocks}</div>}
          </section>
        )
      })}
    </article>
  )
}