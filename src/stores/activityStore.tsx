import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'

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
  autoStart: boolean
  baseUrl: string
}

interface ActivityStore {
  activities: Activity[]
  settings: Settings
  isAnalyzing: boolean
  addActivity: (activity: Omit<Activity, 'id' | 'timestamp'>) => void
  removeActivity: (id: string) => void
  clearActivities: () => void
  updateSettings: (partial: Partial<Settings>) => void
  setIsAnalyzing: (v: boolean) => void
}

const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  intervalSeconds: 300,
  autoStart: false,
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
}

const STORAGE_KEY = 'xiaohei-activities'
const SETTINGS_KEY = 'xiaohei-settings'

function loadActivities(): Activity[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

const ActivityContext = createContext<ActivityStore | null>(null)

export function ActivityProvider({ children }: { children: ReactNode }) {
  const [activities, setActivities] = useState<Activity[]>(loadActivities)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(activities))
  }, [activities])

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  const addActivity = useCallback((activity: Omit<Activity, 'id' | 'timestamp'>) => {
    const newActivity: Activity = {
      ...activity,
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
    }
    setActivities(prev => [newActivity, ...prev])
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
      addActivity, removeActivity, clearActivities, updateSettings, setIsAnalyzing,
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
