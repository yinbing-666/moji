import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'

export interface Activity {
  id: string
  timestamp: string
  category: 'dev' | 'meeting' | 'doc' | 'communication' | 'other'
  app: string
  title: string
  description: string
  screenshotBase64?: string
}

export interface Settings {
  apiKey: string
  intervalSeconds: number
  maxWindowsPerCapture: number
  autoStart: boolean
  baseUrl: string
  excludedKeywords: string[]
  saveScreenshotThumbnails: boolean
}

interface ActivityStore {
  activities: Activity[]
  settings: Settings
  isAnalyzing: boolean
  addActivity: (activity: Omit<Activity, 'id' | 'timestamp'>) => void
  updateActivity: (id: string, partial: Partial<Omit<Activity, 'id' | 'timestamp'>>) => void
  removeActivity: (id: string) => void
  clearActivities: () => void
  updateSettings: (partial: Partial<Settings>) => void
  setIsAnalyzing: (v: boolean) => void
}

const ACTIVITY_CATEGORIES = ['dev', 'meeting', 'doc', 'communication', 'other'] as const

const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  intervalSeconds: 300,
  maxWindowsPerCapture: 3,
  autoStart: false,
  baseUrl: 'https://tokendance.space/gateway/v1',
  excludedKeywords: ['Password', 'Token', 'Bank', '钱包', '验证码', '密钥'],
  saveScreenshotThumbnails: false,
}

const LEGACY_DEFAULT_EXCLUDED_KEYWORDS = ['微信', 'WeChat', 'QQ', 'Mail', '邮箱', 'Password', 'Token', 'Bank']

const STORAGE_KEY = 'xiaohei-activities'
const SETTINGS_KEY = 'xiaohei-settings'

function createActivityId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
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
      excludedKeywords: normalizeExcludedKeywords(saved.excludedKeywords),
      intervalSeconds: Number.isFinite(saved.intervalSeconds)
        ? Math.max(10, Number(saved.intervalSeconds))
        : DEFAULT_SETTINGS.intervalSeconds,
      maxWindowsPerCapture: normalizeMaxWindowsPerCapture(saved.maxWindowsPerCapture),
      autoStart: Boolean(saved.autoStart),
      saveScreenshotThumbnails: Boolean(saved.saveScreenshotThumbnails),
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

  const addActivity = useCallback((activity: Omit<Activity, 'id' | 'timestamp'>) => {
    const newActivity: Activity = {
      ...activity,
      id: createActivityId(),
      timestamp: new Date().toISOString(),
    }
    setActivities(prev => [newActivity, ...prev])
  }, [])

  const updateActivity = useCallback((id: string, partial: Partial<Omit<Activity, 'id' | 'timestamp'>>) => {
    setActivities(prev => prev.map(activity => (
      activity.id === id ? { ...activity, ...partial } : activity
    )))
  }, [])

  const removeActivity = useCallback((id: string) => {
    setActivities(prev => prev.filter(a => a.id !== id))
  }, [])

  const clearActivities = useCallback(() => {
    setActivities([])
  }, [])

  const updateSettings = useCallback((partial: Partial<Settings>) => {
    setSettings(prev => ({ ...prev, ...partial }))
  }, [])

  return (
    <ActivityContext.Provider value={{
      activities, settings, isAnalyzing,
      addActivity, updateActivity, removeActivity, clearActivities, updateSettings, setIsAnalyzing,
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
