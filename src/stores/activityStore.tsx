/**
 * 墨记活动状态管理（Context Store）
 *
 * 数据源类型：'window_text' | 'aw'（旧值 'screenshot' 已迁移为 'window_text'，识别基于窗口文本不再截图）
 */
import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import {
  dbSaveActivity,
  dbLoadActivities,
  dbDeleteActivity,
  dbClearActivities,
  dbSaveBackup,
  dbFetchAwEvents,
  isSqliteAvailable,
} from '../utils/db'

export type BackgroundPreset = 'plain' | 'mint' | 'sky' | 'graphite' | 'custom'

export interface Appearance {
  backgroundPreset: BackgroundPreset
  customBackground?: string
}

/* P2优化: Activity类型定义 - 保持原有结构，screenshotBase64用于缩略图展示 */
export interface Activity {
  id: string
  timestamp: string
  category: 'dev' | 'meeting' | 'doc' | 'communication' | 'other'
  app: string
  title: string
  description: string
  screenshotBase64?: string
}

/* DataSource 类型 - 两种模式：窗口文本识别（UIA，不截图）或 ActivityWatch */
export type DataSource = 'window_text' | 'aw'

export interface Settings {
  apiKey: string
  intervalSeconds: number
  maxWindowsPerCapture: number
  autoStart: boolean
  baseUrl: string
  textModel: string
  excludedKeywords: string[]
  excludedApps: string[]
  excludedTitlePatterns: string[]
  saveScreenshotThumbnails: boolean
  appearance: Appearance
  dataSource: DataSource
  awHost: string
  awPort: number
  awSyncMinutes: number
}

interface ActivityStore {
  activities: Activity[]
  settings: Settings
  isAnalyzing: boolean
  sqliteReady: boolean
  addActivity: (activity: Omit<Activity, 'id' | 'timestamp'>) => void
  /** 导入用：保留原始 id / timestamp */
  importActivity: (activity: Activity) => boolean
  updateActivity: (id: string, partial: Partial<Omit<Activity, 'id' | 'timestamp'>>) => void
  removeActivity: (id: string) => void
  clearActivities: () => void
  /** 从 SQLite 重新加载（备份恢复后用） */
  reloadFromSqlite: () => Promise<number>
  updateSettings: (partial: Partial<Settings>) => void
  setIsAnalyzing: (v: boolean) => void
  /** 从 ActivityWatch 拉取数据并写入活动记录，返回新增条数 */
  syncFromAw: () => Promise<number>
  /* P1优化: 新增报告生成相关方法 */
  generateDailyReport: (date: string) => Promise<void>
  isGeneratingReport: boolean
  connectionTestResult: { ok: boolean; message: string } | null
  testAiConnection: () => Promise<void>
  /* P1优化: 新增数据导入导出方法 */
  importActivitiesFromJson: (data: unknown) => Promise<number>
  exportActivitiesAsJson: () => Promise<string>
  clearAllActivities: () => Promise<void>
}

const ACTIVITY_CATEGORIES = ['dev', 'meeting', 'doc', 'communication', 'other'] as const

const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  intervalSeconds: 300,
  maxWindowsPerCapture: 3,
  autoStart: false,
  baseUrl: 'https://tokendance.space/gateway/v1',
  textModel: 'deepseek-v4-flash-0731',
  excludedKeywords: ['Password', 'Token', 'Bank', '钱包', '验证码', '密钥'],
  excludedApps: [],
  excludedTitlePatterns: [],
  saveScreenshotThumbnails: false,
  appearance: { backgroundPreset: 'plain' },
  dataSource: 'window_text',
  awHost: '127.0.0.1',
  awPort: 5600,
  awSyncMinutes: 5,
}

const LEGACY_DEFAULT_EXCLUDED_KEYWORDS = ['微信', 'WeChat', 'QQ', 'Mail', '邮箱', 'Password', 'Token', 'Bank']

const STORAGE_KEY = 'xiaohei-activities'
const SETTINGS_KEY = 'xiaohei-settings'

function createActivityId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/** AW 窗口标题/应用 → 墨记分类（关键词规则，零成本替代 AI 识别） */
const CATEGORY_RULES: Array<{ category: Activity['category']; patterns: RegExp }> = [
  { category: 'dev', patterns: /vscode|code\.exe|visual studio|terminal|cmd|powershell|git|github|jetbrains|pycharm|webstorm|idea|claude|codex|docker|sql|python|node|chrome.*devtools|localhost|127\.0\.0\.1|:3000|:1420/i },
  { category: 'doc', patterns: /word|document|wps|notion|obsidian|typora|markdown|\.md|excel|ppt|pdf|readme|笔记|文档|写作|墨记/i },
  { category: 'communication', patterns: /微信|wechat|qq|dingtalk|钉钉|飞书|feishu|lark|slack|telegram|discord|企业微信|whatsapp|邮箱|mail|outlook|163|gmail/i },
  { category: 'meeting', patterns: /zoom|腾讯会议|meeting|teams|meet|会议|语音|直播|bilibili|抖音|虎牙|youtube|视频/i },
]

export function classifyAwWindow(app: string, title: string): Activity['category'] {
  const haystack = `${app} ${title}`
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.test(haystack)) return rule.category
  }
  return 'other'
}

/** 把 AW 事件转成墨记活动；重复窗口短停留直接过滤 */
export function awEventToActivity(event: {
  timestamp: string
  duration: number
  data: { app?: string; title?: string }
}): Omit<Activity, 'id' | 'timestamp'> | null {
  const app = (event.data?.app || '未知应用').trim()
  const title = (event.data?.title || '').trim()
  if (!app && !title) return null
  // 少于 10 秒的窗口切换不记录，避免噪音
  if (event.duration < 10) return null

  const category = classifyAwWindow(app, title)
  const durationText = event.duration >= 60
    ? `（${Math.round(event.duration / 60)} 分钟）`
    : `（${Math.round(event.duration)} 秒）`

  return {
    category,
    app,
    title,
    description: title ? `${title}${durationText}` : `${app}${durationText}`,
  }
}

function isActivityCategory(value: unknown): value is Activity['category'] {
  return typeof value === 'string'
    && (ACTIVITY_CATEGORIES as readonly string[]).includes(value)
}

function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function normalizeActivity(value: unknown): Activity | null {
  if (!value || typeof value !== 'object') return null

  const item = value as Partial<Activity>
  const timestamp = typeof item.timestamp === 'string' && !Number.isNaN(Date.parse(item.timestamp))
    ? item.timestamp
    : new Date().toISOString()
  const screenshotBase64 = typeof item.screenshotBase64 === 'string' && item.screenshotBase64.trim()
    ? item.screenshotBase64
    : undefined

  return {
    id: typeof item.id === 'string' && item.id.trim() ? item.id : createActivityId(),
    timestamp,
    category: isActivityCategory(item.category) ? item.category : 'other',
    app: normalizeString(item.app, '未知应用').trim() || '未知应用',
    title: normalizeString(item.title),
    description: normalizeString(item.description, '无描述').trim() || '无描述',
    ...(screenshotBase64 ? { screenshotBase64 } : {}),
  }
}

const VALID_BG_PRESETS: BackgroundPreset[] = ['plain', 'mint', 'sky', 'graphite', 'custom']

function normalizeAppearance(value: unknown): Appearance {
  if (!value || typeof value !== 'object') return DEFAULT_SETTINGS.appearance
  const a = value as Partial<Appearance>
  const backgroundPreset: BackgroundPreset = (VALID_BG_PRESETS as string[]).includes(a.backgroundPreset as string)
    ? a.backgroundPreset as BackgroundPreset
    : DEFAULT_SETTINGS.appearance.backgroundPreset
  const customBackground = typeof a.customBackground === 'string' && a.customBackground.trim()
    ? a.customBackground
    : undefined
  return { backgroundPreset, ...(customBackground ? { customBackground } : {}) }
}

function normalizeExcludedKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return DEFAULT_SETTINGS.excludedKeywords

  const keywords = value.filter((keyword: unknown): keyword is string => typeof keyword === 'string')
  const isLegacyDefault =
    keywords.length === LEGACY_DEFAULT_EXCLUDED_KEYWORDS.length
    && keywords.every((keyword, index) => keyword === LEGACY_DEFAULT_EXCLUDED_KEYWORDS[index])

  return isLegacyDefault ? DEFAULT_SETTINGS.excludedKeywords : keywords
}

function normalizeMaxWindowsPerCapture(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.min(8, Math.max(1, Math.round(parsed)))
    : DEFAULT_SETTINGS.maxWindowsPerCapture
}

function loadActivities(): Activity[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed
      .map(normalizeActivity)
      .filter((activity): activity is Activity => activity !== null)
  } catch {
    return []
  }
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const saved = JSON.parse(raw)
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      apiKey: typeof saved.apiKey === 'string' ? saved.apiKey : '',
      baseUrl: typeof saved.baseUrl === 'string' && saved.baseUrl.trim()
        ? saved.baseUrl
        : DEFAULT_SETTINGS.baseUrl,
      textModel: typeof saved.textModel === 'string' && saved.textModel.trim()
        ? saved.textModel.trim()
        // 旧配置迁移：合并 analysisModel / reportModel 为单一文本模型
        : (typeof saved.reportModel === 'string' && saved.reportModel.trim())
          ? saved.reportModel.trim()
          : DEFAULT_SETTINGS.textModel,
      excludedKeywords: normalizeExcludedKeywords(saved.excludedKeywords),
      intervalSeconds: Number.isFinite(saved.intervalSeconds)
        ? Math.max(10, Number(saved.intervalSeconds))
        : DEFAULT_SETTINGS.intervalSeconds,
      maxWindowsPerCapture: normalizeMaxWindowsPerCapture(saved.maxWindowsPerCapture),
      autoStart: Boolean(saved.autoStart),
      excludedApps: Array.isArray(saved.excludedApps)
        ? saved.excludedApps.filter((k: unknown): k is string => typeof k === 'string' && k.trim().length > 0).map((k: string) => k.trim())
        : DEFAULT_SETTINGS.excludedApps,
      excludedTitlePatterns: Array.isArray(saved.excludedTitlePatterns)
        ? saved.excludedTitlePatterns.filter((k: unknown): k is string => typeof k === 'string' && k.trim().length > 0).map((k: string) => k.trim())
        : DEFAULT_SETTINGS.excludedTitlePatterns,
      saveScreenshotThumbnails: Boolean(saved.saveScreenshotThumbnails),
      appearance: normalizeAppearance(saved.appearance),
      // 旧值 'screenshot' 迁移为 'window_text'（识别已改为窗口文本，不再截图）
      dataSource: saved.dataSource === 'aw' ? 'aw' : 'window_text',
      awHost: typeof saved.awHost === 'string' && saved.awHost.trim() ? saved.awHost.trim() : DEFAULT_SETTINGS.awHost,
      awPort: Number.isFinite(saved.awPort) && saved.awPort > 0 ? Math.round(saved.awPort) : DEFAULT_SETTINGS.awPort,
      awSyncMinutes: Number.isFinite(saved.awSyncMinutes) && saved.awSyncMinutes > 0 ? Math.round(saved.awSyncMinutes) : DEFAULT_SETTINGS.awSyncMinutes,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

const ActivityContext = createContext<ActivityStore | null>(null)

export function ActivityProvider({ children }: { children: ReactNode }) {
  const [activities, setActivities] = useState<Activity[]>(loadActivities)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  /* P1优化: 报告生成状态 */
  const [isGeneratingReport, setIsGeneratingReport] = useState(false)
  const [connectionTestResult, setConnectionTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  // activities 单条可能几百 KB（含缩略图），debounce 500ms 写盘，避免每次 addActivity 都同步 stringify+落盘卡顿
  const activitiesRef = useRef(activities)
  const saveTimerRef = useRef<number | null>(null)

  useEffect(() => {
    activitiesRef.current = activities
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(activitiesRef.current))
      saveTimerRef.current = null
    }, 500)
  }, [activities])

  // 卸载时 flush 最后一次待写数据，避免丢记录
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(activitiesRef.current))
      }
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  // SQLite 启动加载 / 迁移
  const sqliteReadyRef = useRef(false)
  const [sqliteReady, setSqliteReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const available = await isSqliteAvailable()
      if (cancelled) return
      setSqliteReady(available)
      if (!available) return
      sqliteReadyRef.current = true
      try {
        const sqliteData = await dbLoadActivities()
        if (cancelled || !sqliteData) return
        if (sqliteData.length > 0) {
          // SQLite 有数据，用它覆盖 localStorage（优先信任 SQLite）
          const mapped: Activity[] = sqliteData.map(a => normalizeActivity({
            id: a.id,
            timestamp: a.timestamp,
            category: a.category,
            app: a.app_name,
            title: a.title ?? '',
            description: a.description,
            screenshotBase64: a.screenshot_base64 ?? undefined,
          })).filter((a): a is Activity => a !== null)
          setActivities(mapped)
        } else {
          // SQLite 空但 localStorage 有数据 → 迁移
          const local = loadActivities()
          if (local.length > 0) {
            // Bulk import via Rust command
            const { dbImportActivities } = await import('../utils/db')
            await dbImportActivities(JSON.stringify(local))
          }
        }
      } catch {
        sqliteReadyRef.current = false
      }
    })()
    return () => { cancelled = true }
  }, [])

  const saveToSqlite = useCallback((activity: Activity) => {
    if (!sqliteReady) return
    void dbSaveActivity(activity).catch(() => {})
  }, [sqliteReady])

  const addActivity = useCallback((activity: Omit<Activity, 'id' | 'timestamp'>) => {
    const newActivity: Activity = {
      ...activity,
      id: createActivityId(),
      timestamp: new Date().toISOString(),
    }
    setActivities(prev => [newActivity, ...prev])
    saveToSqlite(newActivity)
  }, [saveToSqlite])

  const importActivity = useCallback((activity: Activity): boolean => {
    const normalized = normalizeActivity(activity)
    if (!normalized) return false
    // 用 ref 读当前列表，避免 setState 异步导致返回值不可靠
    if (activitiesRef.current.some(a => a.id === normalized.id)) return false
    setActivities(prev => {
      if (prev.some(a => a.id === normalized.id)) return prev
      return [normalized, ...prev]
    })
    saveToSqlite(normalized)
    return true
  }, [saveToSqlite])

  const updateActivity = useCallback((id: string, partial: Partial<Omit<Activity, 'id' | 'timestamp'>>) => {
    setActivities(prev => {
      const next = prev.map(activity =>
        activity.id === id ? { ...activity, ...partial } : activity,
      )
      const updated = next.find(a => a.id === id)
      if (updated) saveToSqlite(updated)
      return next
    })
  }, [saveToSqlite])

  const removeActivity = useCallback((id: string) => {
    setActivities(prev => prev.filter(a => a.id !== id))
    if (sqliteReady) void dbDeleteActivity(id).catch(() => {})
  }, [sqliteReady])

  const clearActivities = useCallback(() => {
    setActivities([])
    if (sqliteReady) void dbClearActivities().catch(() => {})
  }, [sqliteReady])

  const reloadFromSqlite = useCallback(async (): Promise<number> => {
    if (!sqliteReady) return 0
    const sqliteData = await dbLoadActivities()
    if (!sqliteData) return 0
    const mapped: Activity[] = sqliteData.map(a => normalizeActivity({
      id: a.id,
      timestamp: a.timestamp,
      category: a.category,
      app: a.app_name,
      title: a.title ?? '',
      description: a.description,
      screenshotBase64: a.screenshot_base64 ?? undefined,
    })).filter((a): a is Activity => a !== null)
    setActivities(mapped)
    return mapped.length
  }, [sqliteReady])

  // 定期自动备份 SQLite（30 秒间隔）
  const backupTimerRef = useRef<number | null>(null)
  useEffect(() => {
    if (!sqliteReady) return
    backupTimerRef.current = window.setInterval(() => {
      void dbSaveBackup().catch(() => {})
    }, 30000)
    return () => {
      if (backupTimerRef.current !== null) {
        window.clearInterval(backupTimerRef.current)
      }
    }
  }, [sqliteReady])

  const updateSettingsCallback = useCallback((partial: Partial<Settings>) => {
    setSettings(prev => ({ ...prev, ...partial }))
  }, [])

  /** 从 ActivityWatch 同步：拉事件 → 转活动 → 去重写入 */
  const syncFromAw = useCallback(async (): Promise<number> => {
    let added = 0
    try {
      const result = await dbFetchAwEvents({
        host: settings.awHost,
        port: settings.awPort,
        limit: 2000,
      })
      if (!result) return 0

      // 已有记录 key 集合（app::title::分钟）用于去重
      const existingKeys = new Set(
        activitiesRef.current.map(a => `${a.app}::${a.title}::${Math.round(new Date(a.timestamp).getTime() / 60000)}`),
      )

      const now = Date.now()
      for (const event of result.events) {
        const activity = awEventToActivity(event)
        if (!activity) continue

        // 用事件时间戳作为记录时间（AW 返回 ISO 字符串）
        const eventTime = event.timestamp ? new Date(event.timestamp) : new Date(now)
        if (Number.isNaN(eventTime.getTime())) continue
        const key = `${activity.app}::${activity.title}::${Math.round(eventTime.getTime() / 60000)}`
        if (existingKeys.has(key)) continue
        existingKeys.add(key)

        const newActivity: Activity = {
          ...activity,
          id: createActivityId(),
          timestamp: eventTime.toISOString(),
        }
        setActivities(prev => [newActivity, ...prev])
        saveToSqlite(newActivity)
        added++
      }
      return added
    } catch (err) {
      console.error('AW sync failed:', err)
      return added
    }
  }, [settings.awHost, settings.awPort, saveToSqlite])

  /* P1优化: 测试AI连接 */
  const testAiConnectionCallback = useCallback(async () => {
    try {
      const { testAiConnection } = await import('../utils/ai')
      setIsGeneratingReport(true)
      const result = await testAiConnection(settings.apiKey, settings.baseUrl, settings.textModel)
      setConnectionTestResult(result)
    } catch (err) {
      setConnectionTestResult({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setIsGeneratingReport(false)
    }
  }, [settings.apiKey, settings.baseUrl, settings.textModel])

  /* P1优化: 生成日报 */
  const generateDailyReport = useCallback(async (date: string) => {
    try {
      const { generateReport } = await import('../utils/ai')
      setIsGeneratingReport(true)
      
      // 筛选指定日期的活动
      const dayActivities = activitiesRef.current.filter(a => a.timestamp.startsWith(date))
      
      const reportContent = await generateReport(
        dayActivities.map(a => ({
          timestamp: a.timestamp,
          description: a.description,
          category: a.category,
          app_name: a.app,
        })),
        'daily',
        settings.apiKey,
        settings.baseUrl,
        settings.textModel,
      )

      // 保存到历史记录
      const { addReportHistoryItem, loadReportHistory } = await import('../utils/reportHistory')
      const history = loadReportHistory()
      addReportHistoryItem(history, 'daily', reportContent, 'standard')

      // 可选：自动下载
      const { exportReportAsMarkdown } = await import('../utils/export')
      exportReportAsMarkdown(reportContent, `日报-${date}`)
    } finally {
      setIsGeneratingReport(false)
    }
  }, [activities, settings.apiKey, settings.baseUrl, settings.textModel])

  /* P1优化: 导入JSON数据 */
  const importActivitiesFromJson = useCallback(async (data: unknown): Promise<number> => {
    const { parseImport, mergeImport, normalizeImportItem } = await import('../utils/importData')
    
    let parsed: ReturnType<typeof parseImport>
    if (typeof data === 'string') {
      parsed = parseImport(data)
    } else if (Array.isArray(data)) {
      parsed = data.map(item => normalizeImportItem(item))
    } else {
      throw new Error('导入数据格式错误：需要JSON字符串或数组')
    }

    const { toImport, imported } = mergeImport(parsed, activitiesRef.current)
    
    for (const activity of toImport) {
      importActivity(activity)
    }

    return imported
  }, [importActivity])

  /* P1优化: 导出JSON数据 */
  const exportActivitiesAsJsonCallback = useCallback(async (): Promise<string> => {
    const { exportActivitiesAsJson } = await import('../utils/export')
    exportActivitiesAsJson(activitiesRef.current)
    return JSON.stringify(activitiesRef.current, null, 2)
  }, [])

  /* P1优化: 清空全部数据 */
  const clearAllActivities = useCallback(async (): Promise<void> => {
    clearActivities()
    // 同时清空SQLite
    if (sqliteReady) {
      await dbClearActivities()
    }
  }, [clearActivities, sqliteReady])

  return (
    <ActivityContext.Provider value={{
      activities, settings, isAnalyzing, sqliteReady,
      addActivity, importActivity, updateActivity, removeActivity, clearActivities,
      reloadFromSqlite, updateSettings: updateSettingsCallback, setIsAnalyzing, syncFromAw,
      generateDailyReport, isGeneratingReport, connectionTestResult,
      testAiConnection: testAiConnectionCallback,
      importActivitiesFromJson, exportActivitiesAsJson: exportActivitiesAsJsonCallback,
      clearAllActivities,
    }}>
      {children}
    </ActivityContext.Provider>
  )
}

export function useActivityStore(): ActivityStore {
  const ctx = useContext(ActivityContext)
  if (!ctx) throw new Error('useActivityStore must be used within ActivityProvider')
  return ctx
}
