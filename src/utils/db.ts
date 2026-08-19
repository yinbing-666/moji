/**
 * Tauri SQLite 适配层
 * 
 * [P0优化] 业务逻辑100%保留，所有数据库操作函数完整保留
 * [P1优化] 错误处理、降级策略、类型定义不变
 */

interface DbActivity {
  id: string
  timestamp: string
  category: string
  app_name: string
  title: string | null
  description: string
  screenshot_base64: string | null
  duration_seconds?: number | null
}

interface DbReportHistory {
  id: string
  created_at: string
  report_type: string
  template: string
  content: string
}

let invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null

async function getInvoke() {
  if (invoke) return invoke
  try {
    const mod = await import('@tauri-apps/api/core')
    invoke = mod.invoke
    return invoke
  } catch {
    return null
  }
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  const inv = await getInvoke()
  if (!inv) return null
  try {
    return (await inv(cmd, args)) as T
  } catch {
    return null
  }
}

async function callOr<T>(cmd: string, args: Record<string, unknown> | undefined, fallback: T): Promise<T> {
  const result = await call<T>(cmd, args)
  return result ?? fallback
}

/**
 * 严格调用：后端不可用或命令报错时直接抛出。
 * 用于写操作（保存/删除/备份）——成功不抛错即真实成功，
 * 不再用「返回值 !== null」判断（无返回值的命令序列化为 null，恒被误判失败）。
 */
async function callStrict<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const inv = await getInvoke()
  if (!inv) throw new Error('桌面后端不可用，请在桌面端运行')
  return (await inv(cmd, args)) as T
}

// ── Activities ──

export async function dbSaveActivity(activity: {
  id: string
  timestamp: string
  category: string
  app: string
  title: string
  description: string
  screenshotBase64?: string
  durationSeconds?: number
}): Promise<void> {
  await callStrict('db_save_activity', {
    id: activity.id,
    timestamp: activity.timestamp,
    category: activity.category,
    appName: activity.app,
    title: activity.title || null,
    description: activity.description,
    screenshotBase64: activity.screenshotBase64 || null,
    durationSeconds: activity.durationSeconds ?? null,
  })
}

export async function dbLoadActivities(): Promise<DbActivity[] | null> {
  return call<DbActivity[]>('db_load_activities')
}

export async function dbDeleteActivity(id: string): Promise<void> {
  await callStrict('db_delete_activity', { id })
}

export async function dbClearActivities(): Promise<void> {
  await callStrict('db_clear_activities')
}

export async function dbImportActivities(data: string): Promise<number | null> {
  return call<number>('db_import_activities', { data })
}

// ── Report History ──

export async function dbSaveReportHistory(item: {
  id: string
  createdAt: string
  type: string
  template: string
  content: string
}): Promise<void> {
  await callStrict('db_save_report_history', {
    id: item.id,
    createdAt: item.createdAt,
    reportType: item.type,
    template: item.template,
    content: item.content,
  })
}

export async function dbLoadReportHistory(): Promise<DbReportHistory[] | null> {
  return call<DbReportHistory[]>('db_load_report_history')
}

export async function dbDeleteReportHistory(id: string): Promise<boolean> {
  return (await call('db_delete_report_history', { id })) !== null
}

// ── Backup / Restore ──

/** 触发后端备份，成功返回备份文件字节数；失败（后端不可用/命令报错）抛出异常 */
export async function dbSaveBackup(): Promise<number> {
  return callStrict<number>('save_backup')
}

export async function dbLoadBackup(): Promise<boolean> {
  return (await callOr<boolean>('load_backup', undefined, false))
}

export async function dbRestoreBackupToDb(): Promise<number | null> {
  return call<number>('restore_backup_to_db')
}

// ── ActivityWatch ──

export interface AwEvent {
  timestamp: string
  duration: number
  data: {
    app?: string
    title?: string
    [key: string]: unknown
  }
}

export interface AwSyncResult {
  bucket_id: string
  events: AwEvent[]
  fetched_at: string
}

/** 从 ActivityWatch 拉取窗口事件（走 Rust 后端，避免 CORS） */
export async function dbFetchAwEvents(options?: {
  host?: string
  port?: number
  bucketPrefix?: string
  limit?: number
}): Promise<AwSyncResult | null> {
  return call<AwSyncResult>('aw_fetch_events', {
    host: options?.host ?? '127.0.0.1',
    port: options?.port ?? 5600,
    bucketPrefix: options?.bucketPrefix ?? 'aw-watcher-window',
    limit: options?.limit ?? 1000,
  })
}

/** 检查 ActivityWatch 是否在线 */
export async function dbAwHealth(options?: {
  host?: string
  port?: number
}): Promise<{ hostname?: string; version?: string } | null> {
  return call<{ hostname?: string; version?: string }>('aw_health', {
    host: options?.host ?? '127.0.0.1',
    port: options?.port ?? 5601,
  })
}

/** 写入墨记内置的 ActivityWatch 服务。失败不影响本地活动记录。 */
export async function dbWriteAwWindowEvent(input: {
  app: string
  title: string
  duration: number
  timestamp: string
}): Promise<boolean> {
  return (await call('aw_write_window_event', { input })) !== null
}

// ── ActivityWatch Analytics (效率报告) ──

export interface AwAnalyticsResult {
  period_id: string
  pulse: number
  score_status: string
  active_seconds: number
  productive_percent: number
  ai_seconds: number
  deep_work_seconds: number
  deep_work_blocks: number
  levels: Array<{ level: string; seconds: number; percent: number; points: number }>
  report_json: string
  report_content: string
  report_html: string
}

/** 运行 AW 效率分析(Python 脚本),返回关键指标 */
export async function runAwAnalytics(period: string): Promise<AwAnalyticsResult | null> {
  return call<AwAnalyticsResult>('run_aw_analytics', { period })
}

/** 用系统默认浏览器打开本地 HTML 报告 */
export async function openAwReport(path: string): Promise<boolean> {
  return (await call('open_aw_report', { path })) !== null
}

// ── System Detection ──

export interface ForegroundWindowInfo {
  process_name: string
  title: string
}

export async function dbGetForegroundWindow(): Promise<ForegroundWindowInfo | null> {
  return call<ForegroundWindowInfo>('get_foreground_window')
}

export async function dbGetIdleSeconds(): Promise<number | null> {
  return call<number>('get_idle_seconds')
}

export async function dbIsScreenLocked(): Promise<boolean> {
  return callOr<boolean>('is_screen_locked', undefined, false)
}

export async function dbDiagnoseDb(): Promise<string | null> {
  return call<string>('diagnose_db')
}

// ── Window Text (UI Automation) ──

export interface WindowText {
  hwnd: string
  title: string
  text: string
  element_count: number
}

/** 读取指定窗口（HWND）内的 UIA 文本；后端不可用时返回 null */
export async function dbReadWindowText(hwnd: string, maxChars = 2000): Promise<WindowText | null> {
  return call<WindowText>('read_window_text', { hwnd, maxChars })
}

/** 检测 SQLite 后端是否可用（一次调用探测） */
let sqliteAvailable: boolean | null = null

export async function isSqliteAvailable(): Promise<boolean> {
  if (sqliteAvailable !== null) return sqliteAvailable
  const result = await call<unknown>('diagnose_db')
  sqliteAvailable = result !== null
  return sqliteAvailable
}
