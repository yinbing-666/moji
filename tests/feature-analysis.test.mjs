import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'

async function loadBundled(entryPoint) {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  })
  const source = Buffer.from(result.outputFiles[0].text).toString('base64')
  return import(`data:text/javascript;base64,${source}`)
}

const rulesModule = await loadBundled('src/utils/classificationRules.ts')
const reportModule = await loadBundled('src/utils/awReport.ts')
const demoModule = await loadBundled('src/utils/demoData.ts')
const diagnosticsModule = await loadBundled('src/utils/diagnostics.ts')
const contextModule = await loadBundled('src/utils/contextSignals.ts')
const searchModule = await loadBundled('src/utils/searchQuery.ts')
const durationModule = await loadBundled('src/utils/activityDuration.ts')
const reportHistoryModule = await loadBundled('src/utils/reportHistory.ts')
const syncDeviceModule = await loadBundled('src/utils/syncDeviceId.ts')
const narrativeModule = await loadBundled('src/utils/narrative.ts')
const aiModule = await loadBundled('src/utils/ai.ts')
const localReportModule = await loadBundled('src/utils/localReport.ts')

const localStorageData = new Map()
globalThis.localStorage = {
  getItem(key) {
    return localStorageData.has(key) ? localStorageData.get(key) : null
  },
  setItem(key, value) {
    localStorageData.set(key, String(value))
  },
  removeItem(key) {
    localStorageData.delete(key)
  },
  clear() {
    localStorageData.clear()
  },
}

function activity(id, minutes, durationSeconds, category, app) {
  const start = new Date('2026-08-22T02:00:00Z').getTime()
  return {
    id,
    timestamp: new Date(start + minutes * 60_000).toISOString(),
    durationSeconds,
    category,
    app,
    title: app,
    description: app,
  }
}

test('classification rules use priority and leave unmatched windows unclassified', () => {
  const defaults = rulesModule.cloneDefaultClassificationRules()
  assert.equal(rulesModule.classifyWindow('Code.exe', 'README.md', defaults), 'dev')
  assert.equal(rulesModule.classifyWindow('unknown.exe', 'mystery', defaults), 'unclassified')

  const custom = rulesModule.createClassificationRule('doc', 'special.exe')
  assert.equal(rulesModule.classifyWindow('special.exe', '', [custom]), 'doc')

  const matches = rulesModule.matchClassificationRules('Code.exe', 'README.md', defaults)
  assert.equal(matches[0].rule.id, 'default-dev')
  assert.equal(matches[0].source, 'app')
  assert.equal(matches[0].keyword, 'code.exe')

  const conflicts = rulesModule.findClassificationRuleConflicts([
    rulesModule.createClassificationRule('doc', 'obsidian'),
    rulesModule.createClassificationRule('meeting', 'obs'),
  ])
  assert.ok(conflicts.some(conflict => conflict.keywords.includes('obs') && conflict.keywords.includes('obsidian')))
})

test('demo week is deterministic, removable by prefix, and includes a comparison baseline', () => {
  const demo = demoModule.createDemoWeek(new Date('2026-08-22T12:00:00+08:00'))
  assert.ok(demo.length >= 14)
  assert.equal(new Set(demo.map(item => item.id)).size, demo.length)
  assert.ok(demo.every(demoModule.isDemoActivity))
  assert.ok(demo.some(item => item.id.includes('current')))
  assert.ok(demo.some(item => item.id.includes('baseline')))
})

test('diagnostic messages redact secrets, query tokens, and local paths', () => {
  const message = diagnosticsModule.sanitizeDiagnosticMessage(
    'Bearer abc.def sk-example123456 https://example.com/?token=secret C:\\Users\\demo\\file.txt',
  )
  assert.ok(!message.includes('abc.def'))
  assert.ok(!message.includes('sk-example'))
  assert.ok(!message.includes('token=secret'))
  assert.ok(!message.includes('Users\\demo'))
})

test('focus analysis merges overlaps and detects a short interruption', () => {
  const interrupted = reportModule.analyzeFocusPatterns([
    activity('1', 0, 1800, 'dev', 'Code'),
    activity('2', 30, 300, 'communication', 'WeChat'),
    activity('3', 35, 1800, 'doc', 'Obsidian'),
  ])
  assert.equal(interrupted.interruptionCount, 1)
  assert.equal(interrupted.deepBlockCount, 2)
  assert.equal(interrupted.focusSeconds, 3600)
  assert.equal(interrupted.switchCount, 2)
  assert.deepEqual(interrupted.topInterruptions, [{ app: 'WeChat', count: 1, seconds: 300 }])

  const overlap = reportModule.analyzeFocusPatterns([
    activity('4', 0, 1800, 'dev', 'Code'),
    activity('5', 0, 1800, 'doc', 'Obsidian'),
  ])
  assert.equal(overlap.focusSeconds, 1800)
  assert.equal(overlap.switchCount, 0)
})

test('efficiency report exposes classification coverage and rule suggestions', () => {
  const classificationRules = [{
    id: 'code',
    name: 'Code',
    category: 'dev',
    appKeywords: ['code'],
    titleKeywords: [],
    enabled: true,
  }]
  const report = reportModule.buildLocalEfficiencyReport([
    activity('1', 0, 1800, 'dev', 'Code'),
    activity('2', 60, 1800, 'unclassified', 'Mystery'),
  ], 'today', new Date('2026-08-22T12:00:00Z'), classificationRules)

  assert.equal(report.summary.category_coverage_percent, 50)
  assert.equal(report.rule_health.rule_count, 1)
  assert.equal(report.rule_health.suggestions.length, 1)
  assert.equal(report.rule_health.suggestions[0].source, 'Mystery')
})

test('weekly efficiency report compares the same range from the previous week', () => {
  const current = activity('current', 0, 3600, 'dev', 'Code')
  const previous = {
    ...activity('previous', 0, 1800, 'doc', 'Obsidian'),
    timestamp: new Date('2026-08-15T02:00:00Z').toISOString(),
  }
  const report = reportModule.buildLocalEfficiencyReport(
    [current, previous],
    'this-week',
    new Date('2026-08-22T12:00:00Z'),
    [],
  )

  assert.equal(report.comparison.previous_available, true)
  assert.equal(report.comparison.active_percent_change, 100)
  assert.ok(report.insights.some(item => item.title.includes('较上周')))
})

test('AFK duration subtracts idle time without producing negative activity', () => {
  assert.equal(durationModule.calculateActiveDurationSeconds(300, 120), 180)
  assert.equal(durationModule.calculateActiveDurationSeconds(300, 300), 0)
  assert.equal(durationModule.calculateActiveDurationSeconds(60, 600), 0)
})

test('optional context extracts only a browser domain and IDE project label', () => {
  const browser = contextModule.extractActivityContext(
    'msedge.exe',
    'Issue · GitHub',
    'Address https://github.com/example/moji/issues/1?token=private',
    { browserDomains: true, ideProjects: false },
  )
  assert.deepEqual(browser, { browserDomain: 'github.com' })
  assert.ok(!JSON.stringify(browser).includes('/example/moji'))

  const ide = contextModule.extractActivityContext(
    'Code.exe',
    'App.tsx — moji-clean — Visual Studio Code',
    '',
    { browserDomains: false, ideProjects: true },
  )
  assert.deepEqual(ide, { ideProject: 'moji-clean' })
})

test('natural search query separates relative date and activity keyword', () => {
  const parsed = searchModule.parseSearchQuery('我昨天在哪里看过 ActivityWatch？', new Date('2026-08-22T12:00:00+08:00'))
  assert.equal(parsed.query, 'ActivityWatch')
  assert.equal(parsed.rangeLabel, '昨天')
  assert.equal(parsed.startAt, '2026-08-20T16:00:00.000Z')
  assert.equal(parsed.endAt, '2026-08-21T16:00:00.000Z')
})

test('report history preserves the source period and filters matching activities', () => {
  const items = [
    { timestamp: '2026-08-17T02:00:00.000Z' },
    { timestamp: '2026-08-23T02:00:00.000Z' },
    { timestamp: '2026-08-24T02:00:00.000Z' },
  ]
  assert.equal(reportHistoryModule.filterActivitiesForReportPeriod(items, 'weekly', '2026-08-19').length, 2)
  assert.equal(reportHistoryModule.filterActivitiesForReportPeriod(items, 'daily', '2026-08-23').length, 1)
  assert.equal(reportHistoryModule.filterActivitiesForReportPeriod(items, 'monthly', '2026-08-01').length, 3)
  assert.equal(reportHistoryModule.reportSourceDate({ id: '2026-08-19_example', createdAt: '2026-08-22T00:00:00Z' }), '2026-08-19')
})

test('local reports use the selected daily, weekly, and monthly periods', () => {
  const reportActivity = (id, timestamp, app) => ({
    id,
    timestamp,
    durationSeconds: 600,
    category: 'dev',
    app,
    title: app,
    description: app,
  })
  const activities = [
    reportActivity('before-week', '2026-08-16T02:00:00.000Z', 'BeforeWeek'),
    reportActivity('week-monday', '2026-08-17T02:00:00.000Z', 'WeekMonday'),
    reportActivity('daily-current', '2026-08-22T02:00:00.000Z', 'DailyCurrent'),
    reportActivity('week-sunday', '2026-08-23T02:00:00.000Z', 'WeekSunday'),
    reportActivity('month-end', '2026-08-31T02:00:00.000Z', 'MonthEnd'),
    reportActivity('next-month', '2026-09-01T02:00:00.000Z', 'NextMonth'),
  ]

  const daily = localReportModule.generateLocalReport(activities, '2026-08-22', 'daily')
  assert.match(daily, /2026年8月22日星期六 工作日报/)
  assert.match(daily, /DailyCurrent/)
  assert.doesNotMatch(daily, /WeekMonday|WeekSunday/)

  const weekly = localReportModule.generateLocalReport(activities, '2026-08-19', 'weekly')
  assert.match(weekly, /2026年8月17日至8月23日 工作周报/)
  assert.match(weekly, /WeekMonday/)
  assert.match(weekly, /WeekSunday/)
  assert.doesNotMatch(weekly, /BeforeWeek|MonthEnd/)
  assert.match(weekly, /8月17日/)

  const monthly = localReportModule.generateLocalReport(activities, '2026-08-01', 'monthly')
  assert.match(monthly, /2026年8月 工作月报/)
  assert.match(monthly, /BeforeWeek/)
  assert.match(monthly, /MonthEnd/)
  assert.doesNotMatch(monthly, /NextMonth/)
  assert.match(monthly, /8月31日/)
})

test('report history round-trip preserves edit metadata and generation mode', () => {
  localStorage.clear()
  const report = {
    id: '2026-08-22_metadata',
    createdAt: '2026-08-22T04:00:00.000Z',
    type: 'weekly',
    template: 'standard',
    content: '# 已编辑报告',
    originContent: '# 原始报告',
    edited: true,
    editedAt: 1_777_777_777_000,
    generationMode: 'local',
  }

  reportHistoryModule.saveReportHistory([report])
  assert.deepEqual(reportHistoryModule.loadReportHistory(), [report])
})

test('report edits preserve the first generated content and reject blank replacements', () => {
  const original = {
    id: '2026-08-22_example',
    createdAt: '2026-08-22T04:00:00.000Z',
    type: 'daily',
    template: 'standard',
    content: '# 原始报告',
  }

  const firstEdit = reportHistoryModule.updateReportHistoryItem([original], original.id, '# 第一次编辑')
  assert.equal(firstEdit[0].content, '# 第一次编辑')
  assert.equal(firstEdit[0].originContent, '# 原始报告')

  const secondEdit = reportHistoryModule.updateReportHistoryItem(firstEdit, original.id, '# 第二次编辑')
  assert.equal(secondEdit[0].originContent, '# 原始报告')

  const reverted = reportHistoryModule.revertReportHistoryItem(secondEdit, original.id)
  assert.equal(reverted[0].content, '# 原始报告')
  assert.equal(reverted[0].edited, undefined)
  const blankHistory = [original]
  assert.strictEqual(reportHistoryModule.updateReportHistoryItem(blankHistory, original.id, '   '), blankHistory)
})

test('narrative ratios allocate overlapping time without exceeding the active union', () => {
  const summary = narrativeModule.computeNarrativeSummary([
    activity('overlap-dev', 0, 3600, 'dev', 'Code'),
    activity('overlap-meeting', 0, 3600, 'meeting', 'Teams'),
  ], new Date('2026-08-22T12:00:00Z'))
  const ratios = Object.values(summary.categoryRatio)

  assert.equal(summary.totalSeconds, 3600)
  assert.ok(ratios.every(ratio => ratio >= 0 && ratio <= 1))
  assert.ok(Math.abs(ratios.reduce((sum, ratio) => sum + ratio, 0) - 1) < 1e-9)
  assert.ok(Math.abs(summary.topApps.reduce((sum, app) => sum + app.seconds, 0) - 3600) < 1e-9)
})

test('narrative cache signature follows the exact LLM payload within the old time bucket', () => {
  const first = {
    totalMinutes: 30,
    activeRange: null,
    topApps: [{ app: 'Code', seconds: 1_790 }],
    categoryRatio: { dev: 1 },
    longestFocus: null,
  }
  const changed = {
    ...first,
    topApps: [{ app: 'Code', seconds: 1_790 }, { app: 'Obsidian', seconds: 10 }],
  }

  const firstSignature = narrativeModule.buildNarrativeCacheSignature(first, 'model-a', 'https://example.com/v1/')
  const changedSignature = narrativeModule.buildNarrativeCacheSignature(changed, 'model-a', 'https://example.com/v1/')
  assert.notEqual(firstSignature, changedSignature)
})

test('AI report stats include measured activity data and monthly prompts use monthly wording', () => {
  const current = [
    activity('stats-dev', 0, 3600, 'dev', 'Code'),
    activity('stats-doc', 60, 1800, 'doc', 'Obsidian'),
  ]
  const previous = [activity('stats-previous', 0, 1800, 'dev', 'Code')]
  const stats = reportModule.buildAiReportStats(current, previous)

  assert.equal(stats.summary.active_seconds, 5400)
  assert.equal(stats.comparison.active_seconds_delta_percent, 200)
  assert.equal(stats.daily_breakdown.length, 1)

  const fragmented = reportModule.buildAiReportStats([
    activity('fragment-focus', 0, 60, 'dev', 'Code'),
    activity('fragment-other', 2, 60, 'other', 'Browser'),
  ])
  assert.ok(fragmented.focus_analysis.fragmentation >= 0)
  assert.ok(fragmented.focus_analysis.fragmentation <= 1)

  const prompt = aiModule.buildReportPrompt({
    period: 'monthly',
    activities: '[2026-08-22] dev | Code | 完成月度功能',
    statsBlock: '活跃时长：1.5h',
  })
  assert.match(prompt, /本月 3-5 个重点/)
  assert.doesNotMatch(prompt, /本周/)
})

test('sync device ids migrate the shared placeholder to a stable unique value', () => {
  const generated = syncDeviceModule.createSyncDeviceId(() => '123e4567-e89b-12d3-a456-426614174000')
  assert.equal(generated, 'device-123e4567e89b')
  assert.equal(syncDeviceModule.resolveSyncDeviceId('device', generated), generated)
  assert.equal(syncDeviceModule.resolveSyncDeviceId('office-pc', generated), 'office-pc')
})
