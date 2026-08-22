import { useMemo, useState } from 'react'
import { categoryVisual } from '../utils/categoryStyles'
import {
  RULE_CATEGORIES,
  cloneDefaultClassificationRules,
  findClassificationRuleConflicts,
  type ClassificationRule,
  type RuleCategory,
} from '../utils/classificationRules'

interface ClassificationRulesEditorProps {
  rules: ClassificationRule[]
  onChange: (rules: ClassificationRule[]) => void
}

function keywordText(keywords: string[]): string {
  return keywords.join('\n')
}

function parseKeywords(value: string): string[] {
  return Array.from(new Set(
    value
      .split(/[\n,，]/)
      .map(item => item.trim())
      .filter(Boolean),
  ))
}

export function ClassificationRulesEditor({ rules, onChange }: ClassificationRulesEditorProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const issuesByRule = useMemo(() => {
    const conflicts = findClassificationRuleConflicts(rules)
    const result = new Map<string, string[]>()
    for (const rule of rules) {
      const issues: string[] = []
      if (rule.enabled && rule.appKeywords.length + rule.titleKeywords.length === 0) issues.push('没有关键词')
      const overlaps = conflicts
        .filter(conflict => conflict.ruleIds.includes(rule.id))
        .map(conflict => `“${conflict.keywords[0]}”与“${conflict.keywords[1]}”`)
      if (overlaps.length > 0) issues.push(`关键词范围重叠：${Array.from(new Set(overlaps)).join('、')}`)
      result.set(rule.id, issues)
    }
    return result
  }, [rules])

  const issueCount = Array.from(issuesByRule.values()).filter(issues => issues.length > 0).length

  const updateRule = (id: string, partial: Partial<ClassificationRule>) => {
    onChange(rules.map(rule => rule.id === id ? { ...rule, ...partial } : rule))
  }

  const addRule = () => {
    const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const next: ClassificationRule = {
      id,
      name: '新分类规则',
      category: 'other',
      appKeywords: [],
      titleKeywords: [],
      enabled: true,
    }
    onChange([...rules, next])
    setExpandedId(id)
  }

  const moveRule = (index: number, offset: -1 | 1) => {
    const target = index + offset
    if (target < 0 || target >= rules.length) return
    const next = [...rules]
    const current = next[index]
    next[index] = next[target]
    next[target] = current
    onChange(next)
  }

  const removeRule = (rule: ClassificationRule) => {
    if (!window.confirm(`确定删除规则“${rule.name}”？已分类的历史记录不会改变。`)) return
    onChange(rules.filter(item => item.id !== rule.id))
    if (expandedId === rule.id) setExpandedId(null)
  }

  const restoreDefaults = () => {
    if (!window.confirm('确定恢复默认分类规则？当前自定义规则会被替换，历史记录不会改变。')) return
    onChange(cloneDefaultClassificationRules())
    setExpandedId(null)
  }

  return (
    <section className="rounded-xl border border-gray-200/60 bg-white p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-h3 font-semibold text-gray-900">分类规则</h2>
          <p className="mt-1 text-xs text-gray-500">从上到下匹配应用名和窗口标题；首条命中的规则生效，未命中进入未分类。</p>
          {issueCount > 0 && <p className="mt-1 text-xs text-amber-700">{issueCount} 条规则需要检查，展开后可查看具体原因。</p>}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={restoreDefaults} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-400 hover:text-gray-800">
            恢复默认
          </button>
          <button type="button" onClick={addRule} className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700">
            新建规则
          </button>
        </div>
      </div>

      {rules.length === 0 ? (
        <div className="border-y border-dashed border-gray-200 py-8 text-center text-sm text-gray-500">
          暂无规则，新采集的活动会进入未分类。
        </div>
      ) : (
        <div className="divide-y divide-gray-200 border-y border-gray-200">
          {rules.map((rule, index) => {
            const expanded = expandedId === rule.id
            const visual = categoryVisual(rule.category)
            const keywordCount = rule.appKeywords.length + rule.titleKeywords.length
            const issues = issuesByRule.get(rule.id) ?? []
            return (
              <div key={rule.id} className="py-3">
                <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                  <span className="hidden w-5 shrink-0 text-center text-xs tabular-nums text-gray-400 sm:block">{index + 1}</span>
                  <div className="flex shrink-0 gap-0.5 sm:flex-col sm:gap-0">
                    <button type="button" onClick={() => moveRule(index, -1)} disabled={index === 0} aria-label={`上移规则 ${rule.name}`} className="h-4 px-1 text-[10px] leading-none text-gray-400 hover:text-gray-700 disabled:opacity-25">↑</button>
                    <button type="button" onClick={() => moveRule(index, 1)} disabled={index === rules.length - 1} aria-label={`下移规则 ${rule.name}`} className="h-4 px-1 text-[10px] leading-none text-gray-400 hover:text-gray-700 disabled:opacity-25">↓</button>
                  </div>
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={event => updateRule(rule.id, { enabled: event.target.checked })}
                    aria-label={`${rule.enabled ? '停用' : '启用'}规则 ${rule.name}`}
                    className="h-4 w-4 shrink-0 accent-brand-600"
                  />
                  <button type="button" onClick={() => setExpandedId(expanded ? null : rule.id)} className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left sm:flex-row sm:items-center sm:gap-2">
                    <span className="max-w-full truncate text-sm font-medium text-gray-800">{rule.name}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ring-1 ${visual.badge}`}>{visual.label}</span>
                    <span className="hidden shrink-0 text-xs text-gray-400 sm:inline">{keywordCount} 个关键词</span>
                    {issues.length > 0 && <span className="shrink-0 text-[11px] text-amber-700">需检查</span>}
                  </button>
                  <button type="button" onClick={() => setExpandedId(expanded ? null : rule.id)} className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800">
                    {expanded ? '收起' : '编辑'}
                  </button>
                </div>

                {expanded && (
                  <div className="ml-8 mt-3 grid gap-3 border-l-2 border-brand-100 pl-4 md:grid-cols-2">
                    {issues.length > 0 && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 md:col-span-2">{issues.join('；')}</p>}
                    <label className="text-xs font-medium text-gray-600">
                      规则名称
                      <input
                        type="text"
                        value={rule.name}
                        onChange={event => updateRule(rule.id, { name: event.target.value })}
                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-100"
                      />
                    </label>
                    <label className="text-xs font-medium text-gray-600">
                      归入分类
                      <select
                        value={rule.category}
                        onChange={event => updateRule(rule.id, { category: event.target.value as RuleCategory })}
                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-100"
                      >
                        {RULE_CATEGORIES.map(category => <option key={category} value={category}>{categoryVisual(category).label}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-medium text-gray-600">
                      应用名关键词
                      <textarea
                        rows={4}
                        value={keywordText(rule.appKeywords)}
                        onChange={event => updateRule(rule.id, { appKeywords: parseKeywords(event.target.value) })}
                        placeholder={'code.exe\nobsidian'}
                        className="mt-1 w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-100"
                      />
                    </label>
                    <label className="text-xs font-medium text-gray-600">
                      窗口标题关键词
                      <textarea
                        rows={4}
                        value={keywordText(rule.titleKeywords)}
                        onChange={event => updateRule(rule.id, { titleKeywords: parseKeywords(event.target.value) })}
                        placeholder={'GitHub\n项目名称'}
                        className="mt-1 w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-100"
                      />
                    </label>
                    <div className="md:col-span-2 flex justify-end">
                      <button type="button" onClick={() => removeRule(rule)} className="rounded-md px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
                        删除规则
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
