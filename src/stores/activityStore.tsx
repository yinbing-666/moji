/**
 * 墨记活动状态管理（Context Store）
 *
 * 数据模式：'llm' | 'local'（旧值 window_text / aw / both 在读取设置时自动迁移）
 */
import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import {
  dbSaveActivity,
  dbLoadActivities,
  dbDeleteActivity,
  dbClearActivities,
  dbReplaceActivities,
  dbSaveBackup,
  dbFetchAwEvents,
  dbLoadReportHistory,
  isSqliteAvailable,
  type DbReportHistory,
} from '../utils/db'
import {
  filterActivitiesForReportPeriod,
  hasStoredReportHistory,
  loadReportHistory,
  removeReportHistoryItem,
  updateReportHistoryItem,
  revertReportHistoryItem,
  saveReportHistory,
  type ReportHistoryItem,
} from '../utils/reportHistory'
import { createSyncDeviceId, resolveSyncDeviceId } from '../utils/syncDeviceId'
import { recordDiagnostic } from '../utils/diagnostics'
import { generateLocalDailyReport } from '../utils/localReport'
import { getTemplateDescription, loadCustomTemplates } from '../utils/templates'
import { createDemoWeek, isDemoActivity } from '../utils/demoData'
import {
  ACTIVITY_CATEGORIES,
  classifyWindow,
  cloneDefaultClassificationRules,
  normalizeClassificationRules,
  type ActivityCategory,
  type ClassificationRule,
} from '../utils/classificationRules'

export type BackgroundPreset = 'plain' | 'mint' | 'sky' | 'graphite' | 'custom'
export type ThemeMode = 'system' | 'light' | 'dark'

export interface Appearance {
  themeMode: ThemeMode
  backgroundPreset: BackgroundPreset
  customBackground?: string
}

/* P2优化: Activity类型定义 - 保持原有结构，screenshotBase64用于缩略图展示 */
export interface Activity {
  id: string
  timestamp: string
  category: ActivityCategory
  app: string
  title: string
  description: string
  screenshotBase64?: string
  /** 该活动的持续秒数（AW 源为事件时长；UIA 源按连续采集周期累计），无值表示未知 */
  durationSeconds?: number
  /** 可选上下文仅在用户显式开启对应采集项后保存。 */
  browserDomain?: string
  ideProject?: string
}

/* 数据模式：LLM 窗口识别，或本地确定性分类（无需 LLM / ActivityWatch） */
export type DataSource = 'llm' | 'local'

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
  classificationRules: ClassificationRule[]
  idleThresholdMinutes: number
  captureBrowserDomains: boolean
  captureIdeProjects: boolean
  retentionDays: number
  localApiEnabled: boolean
  localApiPort: number
  localApiToken: string
  launchAtLogin: boolean
  globalShortcutEnabled: boolean
  systemNotificationsEnabled: boolean
  syncFolder: string
  syncPassword: string
  syncDeviceId: string
  lastSyncAt: string
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
  updateActivitiesCategory: (ids: string[], category: ActivityCategory) => void
  removeActivity: (id: string) => void
  clearActivities: () => void
  /** 从 SQLite 重新加载（备份恢复后用） */
  reloadFromSqlite: () => Promise<number>
  updateSettings: (partial: Partial<Settings>) => void
  setIsAnalyzing: (v: boolean) => void
  /** 从 ActivityWatch 拉取数据并写入活动记录，返回新增条数 */
  syncFromAw: (options?: { host?: string; port?: number }) => Promise<number>
  /* P1优化: 新增报告生成相关方法 */
  generateDailyReport: (date: string, templateKey?: string, reportType?: 'daily' | 'weekly' | 'monthly') => Promise<void>
  isGeneratingReport: boolean
  /** 最近生成/查看的报告（界面展示用） */
  lastReport: import('../utils/reportHistory').ReportHistoryItem | null
  /** 最近 20 条报告历史 */
  reportHistory: import('../utils/reportHistory').ReportHistoryItem[]
  /** 从历史中打开一份报告查看 */
  viewReport: (item: import('../utils/reportHistory').ReportHistoryItem) => void
  /** 删除一条报告历史 */
  deleteReport: (id: string) => void
  /** 编辑报告内容并保存到历史 */
  updateReport: (history: import('../utils/reportHistory').ReportHistoryItem[], id: string, content: string) => void
  /** 还原被编辑的报告到原始内容 */
  revertReport: (id: string) => void
  connectionTestResult: { ok: boolean; message: string } | null
  testAiConnection: (config?: Pick<Settings, 'apiKey' | 'baseUrl' | 'textModel'>) => Promise<void>
  /* P1优化: 新增数据导入导出方法 */
  importActivitiesFromJson: (data: unknown) => Promise<number>
  exportActivitiesAsJson: () => Promise<string>
  clearAllActivities: () => Promise<void>
  loadDemoWeek: () => Promise<number>
  removeDemoData: () => Promise<number>
}

const DEFAULT_SYNC_DEVICE_ID = createSyncDeviceId()

const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  intervalSeconds: 300,
  maxWindowsPerCapture: 3,
  autoStart: false,
  baseUrl: '',
  textModel: '',
  excludedKeywords: ['Password', 'Token', 'Bank', '钱包', '验证码', '密钥'],
  excludedApps: [],
  excludedTitlePatterns: [],
  saveScreenshotThumbnails: false,
  appearance: { themeMode: 'system', backgroundPreset: 'plain' },
  dataSource: 'llm',
  awHost: '127.0.0.1',
  awPort: 5601,
  awSyncMinutes: 5,
  classificationRules: cloneDefaultClassificationRules(),
  idleThresholdMinutes: 5,
  captureBrowserDomains: false,
  captureIdeProjects: false,
  retentionDays: 0,
  localApiEnabled: false,
  localApiPort: 5610,
  localApiToken: '',
  launchAtLogin: false,
  globalShortcutEnabled: false,
  systemNotificationsEnabled: false,
  syncFolder: '',
  syncPassword: '',
  syncDeviceId: DEFAULT_SYNC_DEVICE_ID,
  lastSyncAt: '',
}

const LEGACY_DEFAULT_EXCLUDED_KEYWORDS = ['微信', 'WeChat', 'QQ', 'Mail', '邮箱', 'Password', 'Token', 'Bank']

const STORAGE_KEY = 'xiaohei-activities'
const SETTINGS_KEY = 'xiaohei-settings'
// API Key 单独存储，避免与普通设置混在一起被整体序列化（后续可迁移到 Tauri 安全存储）
const SETTINGS_KEY_API = 'xiaohei-settings-api-key'
const SETTINGS_KEY_SYNC_PASSWORD = 'xiaohei-settings-sync-password'

function createActivityId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/** 把 AW 事件转成墨记活动；重复窗口短停留直接过滤 */
export function awEventToActivity(event: {
  timestamp: string
  duration: number
  data: { app?: string; title?: string }
}, rules = cloneDefaultClassificationRules()): Omit<Activity, 'id' | 'timestamp'> | null {
  const app = (event.data?.app || '未知应用').trim()
  const title = (event.data?.title || '').trim()
  if (!app && !title) return null
  // 少于 10 秒的窗口切换不记录，避免噪音
  if (event.duration < 10) return null

  const category = classifyWindow(app, title, rules)
  const durationText = event.duration >= 60
    ? `（${Math.round(event.duration / 60)} 分钟）`
    : `（${Math.round(event.duration)} 秒）`

  return {
    category,
    app,
    title,
    description: title ? `${title}${durationText}` : `${app}${durationText}`,
    durationSeconds: Math.round(event.duration),
  }
}

function isActivityCategory(value: unknown): value is Activity['category'] {
  return typeof value === 'string'
    && ACTIVITY_CATEGORIES.includes(value as ActivityCategory)
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
  const durationSeconds = typeof item.durationSeconds === 'number' && Number.isFinite(item.durationSeconds) && item.durationSeconds >= 0
    ? Math.round(item.durationSeconds)
    : undefined
  const browserDomain = typeof item.browserDomain === 'string' && item.browserDomain.trim()
    ? item.browserDomain.trim().slice(0, 120)
    : undefined
  const ideProject = typeof item.ideProject === 'string' && item.ideProject.trim()
    ? item.ideProject.trim().slice(0, 80)
    : undefined

  return {
    id: typeof item.id === 'string' && item.id.trim() ? item.id : createActivityId(),
    timestamp,
    category: isActivityCategory(item.category) ? item.category : 'other',
    app: normalizeString(item.app, '未知应用').trim() || '未知应用',
    title: normalizeString(item.title),
    description: normalizeString(item.description, '无描述').trim() || '无描述',
    ...(screenshotBase64 ? { screenshotBase64 } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    ...(browserDomain ? { browserDomain } : {}),
    ...(ideProject ? { ideProject } : {}),
  }
}

const VALID_BG_PRESETS: BackgroundPreset[] = ['plain', 'mint', 'sky', 'graphite', 'custom']
const VALID_THEME_MODES: ThemeMode[] = ['system', 'light', 'dark']

function normalizeAppearance(value: unknown): Appearance {
  if (!value || typeof value !== 'object') return DEFAULT_SETTINGS.appearance
  const a = value as Partial<Appearance>
  const themeMode: ThemeMode = (VALID_THEME_MODES as string[]).includes(a.themeMode as string)
    ? a.themeMode as ThemeMode
    : DEFAULT_SETTINGS.appearance.themeMode
  const backgroundPreset: BackgroundPreset = (VALID_BG_PRESETS as string[]).includes(a.backgroundPreset as string)
    ? a.backgroundPreset as BackgroundPreset
    : DEFAULT_SETTINGS.appearance.backgroundPreset
  const customBackground = typeof a.customBackground === 'string' && a.customBackground.trim()
    ? a.customBackground
    : undefined
  return { themeMode, backgroundPreset, ...(customBackground ? { customBackground } : {}) }
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

function mapReportHistory(items: DbReportHistory[]): ReportHistoryItem[] {
  return items
    .filter(item => item.report_type === 'daily' || item.report_type === 'weekly' || item.report_type === 'monthly')
    .map(item => ({
      id: item.id,
      createdAt: item.created_at,
      type: item.report_type as ReportHistoryItem['type'],
      template: item.template,
      content: item.content,
    }))
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

function hasStoredActivitiesSnapshot(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return false
    const parsed = JSON.parse(raw)
    // 空数组是用户明确清空后的有效快照；含非对象项的数组更像损坏数据，应允许 SQLite 恢复。
    return Array.isArray(parsed)
      && parsed.every(item => item !== null && typeof item === 'object')
  } catch {
    return false
  }
}

function saveActivitiesSnapshot(activities: Activity[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(activities))
    return true
  } catch {
    const withoutScreenshots = activities.map(({ screenshotBase64: _screenshot, ...activity }) => activity)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(withoutScreenshots))
      recordDiagnostic('activity-storage', 'localStorage quota exceeded; saved activity metadata without screenshots', 'warning')
      return true
    } catch (fallbackError) {
      recordDiagnostic('activity-storage', fallbackError, 'error')
      return false
    }
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
      // API Key 从独立存储读取（不再随主设置对象持久化）
      apiKey: typeof saved.apiKey === 'string'
        ? saved.apiKey
        : (localStorage.getItem(SETTINGS_KEY_API) ?? DEFAULT_SETTINGS.apiKey),
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
      // 兼容旧配置：window_text / both 代表有 LLM，aw 代表无 LLM。
      dataSource: saved.dataSource === 'aw' || saved.dataSource === 'local' ? 'local' : 'llm',
      awHost: typeof saved.awHost === 'string' && saved.awHost.trim() ? saved.awHost.trim() : DEFAULT_SETTINGS.awHost,
      // 内置服务从旧版外部 ActivityWatch 默认端口 5600 迁移到墨记专用 5601。
      awPort: Number.isFinite(saved.awPort) && saved.awPort > 0 && Math.round(saved.awPort) !== 5600
        ? Math.round(saved.awPort)
        : DEFAULT_SETTINGS.awPort,
      awSyncMinutes: Number.isFinite(saved.awSyncMinutes) && saved.awSyncMinutes > 0 ? Math.round(saved.awSyncMinutes) : DEFAULT_SETTINGS.awSyncMinutes,
      classificationRules: normalizeClassificationRules(saved.classificationRules),
      idleThresholdMinutes: Number.isFinite(saved.idleThresholdMinutes)
        ? Math.min(30, Math.max(1, Math.round(saved.idleThresholdMinutes)))
        : DEFAULT_SETTINGS.idleThresholdMinutes,
      captureBrowserDomains: Boolean(saved.captureBrowserDomains),
      captureIdeProjects: Boolean(saved.captureIdeProjects),
      retentionDays: [0, 30, 90, 180, 365].includes(Number(saved.retentionDays))
        ? Number(saved.retentionDays)
        : DEFAULT_SETTINGS.retentionDays,
      localApiEnabled: Boolean(saved.localApiEnabled),
      localApiPort: Number.isFinite(saved.localApiPort)
        ? Math.min(65535, Math.max(1024, Math.round(saved.localApiPort)))
        : DEFAULT_SETTINGS.localApiPort,
      localApiToken: typeof saved.localApiToken === 'string' ? saved.localApiToken : '',
      launchAtLogin: Boolean(saved.launchAtLogin),
      globalShortcutEnabled: Boolean(saved.globalShortcutEnabled),
      systemNotificationsEnabled: Boolean(saved.systemNotificationsEnabled),
      syncFolder: typeof saved.syncFolder === 'string' ? saved.syncFolder : '',
      syncPassword: localStorage.getItem(SETTINGS_KEY_SYNC_PASSWORD) ?? '',
      syncDeviceId: resolveSyncDeviceId(saved.syncDeviceId, DEFAULT_SYNC_DEVICE_ID),
      lastSyncAt: typeof saved.lastSyncAt === 'string' ? saved.lastSyncAt : '',
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
  const [lastReport, setLastReport] = useState<ReportHistoryItem | null>(null)
  const [reportHistory, setReportHistory] = useState<ReportHistoryItem[]>(() => loadReportHistory())

  // activities 单条可能几百 KB（含缩略图），debounce 500ms 写盘，避免每次 addActivity 都同步 stringify+落盘卡顿
  const activitiesRef = useRef(activities)
  const hadStoredActivitiesRef = useRef(hasStoredActivitiesSnapshot())
  const saveTimerRef = useRef<number | null>(null)

  useEffect(() => {
    activitiesRef.current = activities
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveActivitiesSnapshot(activitiesRef.current)
      saveTimerRef.current = null
    }, 500)
  }, [activities])

  // 卸载时 flush 最后一次待写数据，避免丢记录
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveActivitiesSnapshot(activitiesRef.current)
      }
    }
  }, [])

  useEffect(() => {
    // API Key 和同步密码单独存储，避免进入普通设置对象及其导出链路。
    const { apiKey, syncPassword, ...rest } = settings
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(rest))
    if (apiKey) {
      localStorage.setItem(SETTINGS_KEY_API, apiKey)
    } else {
      localStorage.removeItem(SETTINGS_KEY_API)
    }
    if (syncPassword) {
      localStorage.setItem(SETTINGS_KEY_SYNC_PASSWORD, syncPassword)
    } else {
      localStorage.removeItem(SETTINGS_KEY_SYNC_PASSWORD)
    }
  }, [settings])

  // SQLite 启动加载 / 迁移
  const sqliteReadyRef = useRef(false)
  const awSyncingRef = useRef(false)
  const [sqliteReady, setSqliteReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const available = await isSqliteAvailable()
      if (cancelled) return
      if (!available) return
      const initialActivities = activitiesRef.current
      const hasLocalSnapshot = hadStoredActivitiesRef.current || initialActivities.length > 0
      try {
        const sqliteData = await dbLoadActivities()
        if (cancelled) return
        if (!sqliteData) throw new Error('SQLite 活动读取失败')

        if (hasLocalSnapshot) {
          // 有效 localStorage 快照是前端当前状态源；事务替换可修复 SQLite 漏写、旧值和多余记录。
          // 替换期间若有新活动到达，重试最新快照，避免初始化窗口丢写。
          let snapshot = activitiesRef.current
          for (let attempt = 0; attempt < 5; attempt++) {
            const replaced = await dbReplaceActivities(JSON.stringify(snapshot))
            if (replaced === null) throw new Error('SQLite 活动同步失败')
            const latest = activitiesRef.current
            if (latest === snapshot) break
            snapshot = latest
          }
        } else if (sqliteData.length > 0) {
          // localStorage 不存在时才从 SQLite 恢复，避免 SQLite 单次写入失败覆盖本地最新状态。
          const restored: Activity[] = sqliteData.map(a => normalizeActivity({
            id: a.id,
            timestamp: a.timestamp,
            category: a.category,
            app: a.app_name,
            title: a.title ?? '',
            description: a.description,
            screenshotBase64: a.screenshot_base64 ?? undefined,
            durationSeconds: a.duration_seconds ?? undefined,
            browserDomain: a.browser_domain ?? undefined,
            ideProject: a.ide_project ?? undefined,
          })).filter((a): a is Activity => a !== null)
          const latest = activitiesRef.current
          const mapped = latest === initialActivities
            ? restored
            : [
                ...latest,
                ...restored.filter(item => !latest.some(current => current.id === item.id)),
              ]
          activitiesRef.current = mapped
          setActivities(mapped)
          if (latest !== initialActivities) {
            const replaced = await dbReplaceActivities(JSON.stringify(mapped))
            if (replaced === null) throw new Error('SQLite 活动同步失败')
          }
        } else if (activitiesRef.current !== initialActivities) {
          // SQLite 为空但初始化期间产生了新记录，也要把最新前端快照落入数据库。
          const replaced = await dbReplaceActivities(JSON.stringify(activitiesRef.current))
          if (replaced === null) throw new Error('SQLite 活动同步失败')
        }

        if (!cancelled) {
          sqliteReadyRef.current = true
          setSqliteReady(true)
        }
      } catch (error) {
        sqliteReadyRef.current = false
        if (!cancelled) setSqliteReady(false)
        console.error('SQLite 初始化或同步失败:', error)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // localStorage 不存在时从 SQLite 恢复报告历史；显式保存的空数组不应被恢复回来。
  useEffect(() => {
    if (hasStoredReportHistory()) return
    void dbLoadReportHistory().then(items => {
      if (!items || items.length === 0) return
      const restored = mapReportHistory(items)
      if (restored.length > 0) {
        saveReportHistory(restored)
        setReportHistory(restored)
      }
    }).catch(() => {})
  }, [])

  const saveToSqlite = useCallback((activity: Activity) => {
    if (!sqliteReady) return
    void dbSaveActivity(activity).then(ok => {
      if (!ok) console.error('SQLite 保存活动失败，本地 localStorage 仍保留当前记录')
    }).catch(() => {})
  }, [sqliteReady])

  const updateActivity = useCallback((id: string, partial: Partial<Omit<Activity, 'id' | 'timestamp'>>) => {
    const next = activitiesRef.current.map(activity =>
      activity.id === id ? { ...activity, ...partial } : activity,
    )
    const updated = next.find(a => a.id === id)
    if (!updated) return
    activitiesRef.current = next
    setActivities(next)
    saveToSqlite(updated)
  }, [saveToSqlite])

  const addActivity = useCallback((activity: Omit<Activity, 'id' | 'timestamp'>) => {
    const newActivity: Activity = {
      ...activity,
      id: createActivityId(),
      timestamp: new Date().toISOString(),
    }
    // 连续窗口去重：覆盖至少一个采集周期，确保默认 5 分钟间隔也能累计时长。
    // UIA 采集（无 durationSeconds）命中去重时，视为同一活动持续了一个采集周期，
    // 把间隔累加到已有记录的时长上，让时间轴能反映真实停留时间。
    const ts = Date.parse(newActivity.timestamp)
    const duplicateWindowMs = Math.max(90_000, (settings.intervalSeconds + 30) * 1000)
    const duplicate = activitiesRef.current.find(a => {
      const activityEnd = Date.parse(a.timestamp) + (a.durationSeconds ?? 0) * 1000
      return a.app === newActivity.app
        && a.title === newActivity.title
        && Math.abs(activityEnd - ts) < duplicateWindowMs
    })
    if (duplicate) {
      updateActivity(duplicate.id, {
        durationSeconds: (duplicate.durationSeconds ?? 0)
          + (newActivity.durationSeconds ?? Math.max(60, settings.intervalSeconds)),
        ...(newActivity.browserDomain ? { browserDomain: newActivity.browserDomain } : {}),
        ...(newActivity.ideProject ? { ideProject: newActivity.ideProject } : {}),
      })
      return
    }
    const next = [newActivity, ...activitiesRef.current]
    activitiesRef.current = next
    setActivities(next)
    saveToSqlite(newActivity)
  }, [saveToSqlite, settings.intervalSeconds, updateActivity])

  const updateActivitiesCategory = useCallback((ids: string[], category: ActivityCategory) => {
    const idSet = new Set(ids)
    if (idSet.size === 0) return
    const updated: Activity[] = []
    const next = activitiesRef.current.map(activity => {
      if (!idSet.has(activity.id) || activity.category === category) return activity
      const changed = { ...activity, category }
      updated.push(changed)
      return changed
    })
    if (updated.length === 0) return
    activitiesRef.current = next
    setActivities(next)
    updated.forEach(saveToSqlite)
  }, [saveToSqlite])

  const importActivity = useCallback((activity: Activity): boolean => {
    const normalized = normalizeActivity(activity)
    if (!normalized) return false
    // 用 ref 读当前列表，避免 setState 异步导致返回值不可靠
    if (activitiesRef.current.some(a => a.id === normalized.id)) return false
    const next = [normalized, ...activitiesRef.current]
    activitiesRef.current = next
    setActivities(next)
    saveToSqlite(normalized)
    return true
  }, [saveToSqlite])

  const removeActivity = useCallback((id: string) => {
    const next = activitiesRef.current.filter(a => a.id !== id)
    activitiesRef.current = next
    setActivities(next)
    if (sqliteReady) void dbDeleteActivity(id).catch(() => {})
  }, [sqliteReady])

  const clearActivities = useCallback(() => {
    activitiesRef.current = []
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
      durationSeconds: a.duration_seconds ?? undefined,
      browserDomain: a.browser_domain ?? undefined,
      ideProject: a.ide_project ?? undefined,
    })).filter((a): a is Activity => a !== null)
    activitiesRef.current = mapped
    setActivities(mapped)

    const sqliteHistory = await dbLoadReportHistory()
    if (sqliteHistory) {
      const restoredHistory = mapReportHistory(sqliteHistory)
      saveReportHistory(restoredHistory)
      setReportHistory(restoredHistory)
      setLastReport(restoredHistory[0] ?? null)
    }
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
  const syncFromAw = useCallback(async (options?: { host?: string; port?: number }): Promise<number> => {
    if (awSyncingRef.current) return 0
    awSyncingRef.current = true
    let added = 0
    try {
      const result = await dbFetchAwEvents({
        host: options?.host ?? settings.awHost,
        port: options?.port ?? settings.awPort,
        limit: 2000,
      })
      if (!result) return 0

      // 已有记录 key 集合（app::title::分钟）用于去重
      const existingKeys = new Set(
        activitiesRef.current.map(a => `${a.app}::${a.title}::${Math.round(new Date(a.timestamp).getTime() / 60000)}`),
      )

      const now = Date.now()
      for (const event of result.events) {
        const activity = awEventToActivity(event, settings.classificationRules)
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
        const next = [newActivity, ...activitiesRef.current]
        activitiesRef.current = next
        setActivities(next)
        saveToSqlite(newActivity)
        added++
      }
      return added
    } catch (err) {
      console.error('AW sync failed:', err)
      return added
    } finally {
      awSyncingRef.current = false
    }
  }, [settings.awHost, settings.awPort, settings.classificationRules, saveToSqlite])

  /* P1优化: 测试AI连接 */
  const testAiConnectionCallback = useCallback(async (config?: Pick<Settings, 'apiKey' | 'baseUrl' | 'textModel'>) => {
    try {
      const { testAiConnection } = await import('../utils/ai')
      setIsGeneratingReport(true)
      const activeConfig = config ?? settings
      const result = await testAiConnection(activeConfig.apiKey, activeConfig.baseUrl, activeConfig.textModel)
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

  /* P1优化: 生成报告 */
  const generateDailyReport = useCallback(async (date: string, templateKey = 'standard', reportType: 'daily' | 'weekly' | 'monthly' = 'daily') => {
    setIsGeneratingReport(true)
    try {
      const dayActivities = filterActivitiesForReportPeriod(activitiesRef.current, reportType, date)

      let reportContent: string

      if (settings.dataSource === 'local') {
        reportContent = generateLocalDailyReport(dayActivities.length > 0 ? dayActivities : activitiesRef.current, date, templateKey)
      } else {
        const { generateReport } = await import('../utils/ai')
        const templateDescription = getTemplateDescription(templateKey, loadCustomTemplates())
        reportContent = await generateReport(
          dayActivities.map(a => ({
            timestamp: a.timestamp,
            description: [
              a.description,
              a.browserDomain ? `浏览器域名：${a.browserDomain}` : '',
              a.ideProject ? `IDE 项目：${a.ideProject}` : '',
            ].filter(Boolean).join('；'),
            category: a.category,
            app_name: a.app,
          })),
          reportType,
          settings.apiKey,
          settings.baseUrl,
          settings.textModel,
          templateDescription,
        )
      }

      // 保存到历史记录并展示在界面上
      const { addReportHistoryItem } = await import('../utils/reportHistory')
      const nextHistory = addReportHistoryItem(loadReportHistory(), reportType, reportContent, templateKey, date)
      setReportHistory(nextHistory)
      setLastReport(nextHistory[0] ?? null)
    } finally {
      setIsGeneratingReport(false)
    }
  }, [settings.apiKey, settings.baseUrl, settings.dataSource, settings.textModel])

  const viewReport = useCallback((item: ReportHistoryItem) => {
    setLastReport(item)
  }, [])

  const deleteReport = useCallback((id: string) => {
    setReportHistory(prev => {
      const next = removeReportHistoryItem(prev, id)
      setLastReport(cur => (cur?.id === id ? next[0] ?? null : cur))
      return next
    })
  }, [])

  const updateReport = useCallback((history: ReportHistoryItem[], id: string, content: string) => {
    const next = updateReportHistoryItem(history, id, content)
    setReportHistory(next)
    setLastReport(cur => (cur?.id === id ? next.find(x => x.id === id) ?? null : cur))
  }, [])

  const revertReport = useCallback((id: string) => {
    setReportHistory(prev => {
      const next = revertReportHistoryItem(prev, id)
      setLastReport(cur => (cur?.id === id ? next.find(x => x.id === id) ?? null : cur))
      return next
    })
  }, [])

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

  const loadDemoWeek = useCallback(async (): Promise<number> => {
    const existingIds = new Set(activitiesRef.current.map(activity => activity.id))
    const additions = createDemoWeek().filter(activity => !existingIds.has(activity.id))
    if (additions.length === 0) return 0
    const next = [...additions, ...activitiesRef.current]
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    activitiesRef.current = next
    setActivities(next)
    if (sqliteReady) await dbReplaceActivities(JSON.stringify(next))
    return additions.length
  }, [sqliteReady])

  const removeDemoData = useCallback(async (): Promise<number> => {
    const next = activitiesRef.current.filter(activity => !isDemoActivity(activity))
    const removed = activitiesRef.current.length - next.length
    if (removed === 0) return 0
    activitiesRef.current = next
    setActivities(next)
    if (sqliteReady) await dbReplaceActivities(JSON.stringify(next))
    return removed
  }, [sqliteReady])

  return (
    <ActivityContext.Provider value={{
      activities, settings, isAnalyzing, sqliteReady,
      addActivity, importActivity, updateActivity, updateActivitiesCategory, removeActivity, clearActivities,
      reloadFromSqlite, updateSettings: updateSettingsCallback, setIsAnalyzing, syncFromAw,
      generateDailyReport, isGeneratingReport, connectionTestResult,
      lastReport, reportHistory, viewReport, deleteReport, updateReport, revertReport,
      testAiConnection: testAiConnectionCallback,
      importActivitiesFromJson, exportActivitiesAsJson: exportActivitiesAsJsonCallback,
      clearAllActivities, loadDemoWeek, removeDemoData,
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
