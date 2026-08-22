import { useCallback, useEffect, useState } from 'react'
import { useActivityStore } from '../stores/activityStore'
import type { BackgroundPreset, DataSource, ThemeMode } from '../stores/activityStore'
import { todayDateKey } from '../utils/date'
import { getAppearancePreview } from '../utils/appearance'
import { ClassificationRulesEditor } from './ClassificationRulesEditor'
import {
  dbDiagnoseDb,
  dbCleanupActivities,
  dbGetStorageStats,
  dbLocalApiStatus,
  dbAwHealth,
  dbLoadBackup,
  dbRestoreBackupToDb,
  dbSaveBackup,
  dbDesktopIntegrationStatus,
  dbListActivitySources,
  dbMcpServerInfo,
  dbPickSyncFolder,
  dbRequestNotificationPermission,
  dbSetAutostart,
  dbSetGlobalShortcut,
  dbSyncWithFolder,
  type ActivitySourceDescriptor,
  type DesktopIntegrationStatus,
  type McpServerInfo,
} from '../utils/db'
import { getDiagnostics } from '../utils/diagnostics'

/* P1优化: 设置页 - 使用层级化表单设计 */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function generateLocalApiToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export function Settings() {
  const {
    settings,
    updateSettings,
    testAiConnection,
    connectionTestResult,
    importActivitiesFromJson,
    exportActivitiesAsJson,
    clearAllActivities,
    sqliteReady,
    reloadFromSqlite,
  } = useActivityStore()

  const [localSettings, setLocalSettings] = useState(settings)
  const [isTestingConnection, setIsTestingConnection] = useState(false)
  const [dbStatus, setDbStatus] = useState<string | null>(null)
  const [backupExists, setBackupExists] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMsg, setBackupMsg] = useState<string | null>(null)
  const [storageStats, setStorageStats] = useState<Awaited<ReturnType<typeof dbGetStorageStats>>>(null)
  const [localApiStatus, setLocalApiStatus] = useState<Awaited<ReturnType<typeof dbLocalApiStatus>>>(null)
  const [desktopStatus, setDesktopStatus] = useState<DesktopIntegrationStatus | null>(null)
  const [activitySources, setActivitySources] = useState<ActivitySourceDescriptor[]>([])
  const [mcpInfo, setMcpInfo] = useState<McpServerInfo | null>(null)
  const [desktopBusy, setDesktopBusy] = useState(false)
  const [desktopMsg, setDesktopMsg] = useState<string | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // 同步外部设置变化到本地状态
  useEffect(() => {
    if (!hasUnsavedChanges) setLocalSettings(settings)
  }, [hasUnsavedChanges, settings])

  const refreshDbInfo = useCallback(async () => {
    try {
      const diag = await dbDiagnoseDb()
      const hasBackup = await dbLoadBackup()
      const cutoff = settings.retentionDays > 0
        ? new Date(Date.now() - settings.retentionDays * 86400000).toISOString()
        : undefined
      const stats = await dbGetStorageStats(cutoff)
      setDbStatus(diag ?? '未检测到桌面后端（浏览器模式 SQLite 不可用）')
      setBackupExists(Boolean(hasBackup))
      setStorageStats(stats)
    } catch (error) {
      setDbStatus(`数据库诊断失败：${error instanceof Error ? error.message : String(error)}`)
      setBackupExists(false)
      setStorageStats(null)
    }
  }, [settings.retentionDays])

  // 挂载时刷新数据库诊断信息（null = 后端不可调用，如纯浏览器调试模式）
  useEffect(() => {
    void refreshDbInfo()
  }, [refreshDbInfo])

  const refreshPlatformInfo = useCallback(async () => {
    const [desktop, sources, mcp] = await Promise.all([
      dbDesktopIntegrationStatus(),
      dbListActivitySources(),
      dbMcpServerInfo(),
    ])
    setDesktopStatus(desktop)
    setActivitySources(sources ?? [])
    setMcpInfo(mcp)
  }, [])

  useEffect(() => {
    void refreshPlatformInfo()
  }, [refreshPlatformInfo])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      void dbLocalApiStatus().then(status => {
        if (!cancelled) setLocalApiStatus(status)
      }).catch(() => {
        if (!cancelled) setLocalApiStatus(null)
      })
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [settings.localApiEnabled, settings.localApiPort, settings.localApiToken])

  /* P1优化: 表单字段更新处理 */
  const updateField = useCallback(<K extends keyof typeof localSettings>(
    field: K,
    value: (typeof localSettings)[K]
  ) => {
    setLocalSettings(prev => ({ ...prev, [field]: value }))
    setHasUnsavedChanges(true)
  }, [])

  /* P1优化: 保存设置 */
  const handleSave = useCallback(() => {
    if (localSettings.localApiEnabled && localSettings.localApiToken.length < 24) {
      window.alert('本地 API 访问令牌至少需要 24 个字符')
      return
    }
    updateSettings(localSettings)
    setHasUnsavedChanges(false)
  }, [localSettings, updateSettings])

  /* P1优化: 测试连接 */
  const handleTestConnection = useCallback(async () => {
    setIsTestingConnection(true)
    try {
      await testAiConnection({
        apiKey: localSettings.apiKey,
        baseUrl: localSettings.baseUrl,
        textModel: localSettings.textModel,
      })
    } catch (err) {
      console.error('连接测试失败:', err)
    } finally {
      setIsTestingConnection(false)
    }
  }, [localSettings.apiKey, localSettings.baseUrl, localSettings.textModel, testAiConnection])

  /* 数据库备份/恢复 */
  const handleBackupNow = useCallback(async () => {
    setBackupBusy(true)
    setBackupMsg(null)
    try {
      const ok = await dbSaveBackup()
      if (!ok) throw new Error('备份失败，请确认已在桌面端运行')
      await refreshDbInfo()
      setBackupMsg('备份已保存到本机应用数据目录')
    } catch (err) {
      setBackupMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setBackupBusy(false)
    }
  }, [refreshDbInfo])

  const handleRestoreBackup = useCallback(async () => {
    if (!window.confirm('确定从备份恢复？当前数据库会被备份文件覆盖。')) return
    setBackupBusy(true)
    setBackupMsg(null)
    try {
      const total = await dbRestoreBackupToDb()
      if (total === null) throw new Error('恢复失败，请确认已在桌面端运行且存在备份')
      const loaded = await reloadFromSqlite()
      await refreshDbInfo()
      setBackupMsg(`恢复完成：数据库约 ${total} 条，界面已加载 ${loaded} 条`)
    } catch (err) {
      setBackupMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setBackupBusy(false)
    }
  }, [refreshDbInfo, reloadFromSqlite])

  /* P1优化: 文件导入处理 */
  const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      await importActivitiesFromJson(text)
    } catch (err) {
      console.error('导入失败:', err)
      alert('导入失败：请检查文件格式是否正确')
    } finally {
      e.target.value = ''
    }
  }, [importActivitiesFromJson])

  /* P1优化: 导出处理 */
  const handleExport = useCallback(async () => {
    try {
      const json = await exportActivitiesAsJson()
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `moji-activities-${todayDateKey()}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (err) {
      console.error('导出失败:', err)
    }
  }, [exportActivitiesAsJson])

  const handleExportDiagnostics = useCallback(async () => {
    const aw = await dbAwHealth({ host: settings.awHost, port: settings.awPort })
    const report = {
      generatedAt: new Date().toISOString(),
      runtime: '__TAURI_INTERNALS__' in window ? 'tauri' : 'browser',
      platform: navigator.platform,
      mode: settings.dataSource,
      capture: {
        intervalSeconds: settings.intervalSeconds,
        maxWindowsPerCapture: settings.maxWindowsPerCapture,
        saveScreenshotThumbnails: settings.saveScreenshotThumbnails,
        excludedAppCount: settings.excludedApps.length,
        excludedTitlePatternCount: settings.excludedTitlePatterns.length,
      },
      storage: { sqliteReady },
      activityWatch: aw ? { available: true, version: aw.version ?? null } : { available: false },
      diagnostics: getDiagnostics(),
      omitted: ['activities', 'window titles', 'screenshots', 'API key', 'API base URL', 'model name'],
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `moji-diagnostics-${todayDateKey()}.json`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }, [settings, sqliteReady])

  /* P1优化: 清空确认 */
  const handleClearAll = useCallback(async () => {
    if (!confirm('确定要清空所有活动记录吗？此操作不可恢复！')) return
    try {
      await clearAllActivities()
    } catch (err) {
      console.error('清空失败:', err)
    }
  }, [clearAllActivities])

  const handleCleanupExpired = useCallback(async () => {
    if (localSettings.retentionDays <= 0 || !storageStats?.expired_count) return
    const confirmed = window.confirm(
      `将删除 ${storageStats.expired_count} 条早于 ${localSettings.retentionDays} 天的活动。清理前会自动备份，是否继续？`,
    )
    if (!confirmed) return
    setBackupBusy(true)
    setBackupMsg(null)
    try {
      const backedUp = await dbSaveBackup()
      if (!backedUp) throw new Error('清理前备份失败，已取消清理')
      const cutoff = new Date(Date.now() - localSettings.retentionDays * 86400000).toISOString()
      const deleted = await dbCleanupActivities(cutoff)
      if (deleted === null) throw new Error('清理失败，请确认已在桌面端运行')
      await reloadFromSqlite()
      await refreshDbInfo()
      setBackupMsg(`已清理 ${deleted} 条过期活动，清理前备份仍保留`)
    } catch (error) {
      setBackupMsg(error instanceof Error ? error.message : String(error))
    } finally {
      setBackupBusy(false)
    }
  }, [localSettings.retentionDays, refreshDbInfo, reloadFromSqlite, storageStats?.expired_count])

  const handleAutostartChange = useCallback(async (enabled: boolean) => {
    setDesktopBusy(true)
    setDesktopMsg(null)
    try {
      const actual = await dbSetAutostart(enabled)
      if (actual === null) throw new Error('仅桌面版支持开机自启')
      setDesktopStatus(current => current ? { ...current, autostartEnabled: actual } : current)
      setLocalSettings(current => ({ ...current, launchAtLogin: actual }))
      updateSettings({ launchAtLogin: actual })
    } catch (error) {
      setDesktopMsg(error instanceof Error ? error.message : String(error))
    } finally {
      setDesktopBusy(false)
    }
  }, [updateSettings])

  const handleShortcutChange = useCallback(async (enabled: boolean) => {
    setDesktopBusy(true)
    setDesktopMsg(null)
    try {
      const actual = await dbSetGlobalShortcut(enabled)
      if (actual === null) throw new Error('仅桌面版支持全局快捷键')
      setDesktopStatus(current => current ? { ...current, shortcutEnabled: actual } : current)
      setLocalSettings(current => ({ ...current, globalShortcutEnabled: actual }))
      updateSettings({ globalShortcutEnabled: actual })
    } catch (error) {
      setDesktopMsg(error instanceof Error ? error.message : String(error))
    } finally {
      setDesktopBusy(false)
    }
  }, [updateSettings])

  const handleNotificationChange = useCallback(async (enabled: boolean) => {
    setDesktopBusy(true)
    setDesktopMsg(null)
    try {
      let permission = desktopStatus?.notificationPermission ?? 'Unknown'
      if (enabled && permission !== 'Granted') {
        const requested = await dbRequestNotificationPermission()
        if (requested === null) throw new Error('仅桌面版支持系统通知')
        permission = requested
      }
      const active = enabled && permission === 'Granted'
      setDesktopStatus(current => current ? { ...current, notificationPermission: permission } : current)
      setLocalSettings(current => ({ ...current, systemNotificationsEnabled: active }))
      updateSettings({ systemNotificationsEnabled: active })
      if (enabled && !active) setDesktopMsg('系统未授予通知权限，请在系统设置中允许墨记发送通知')
    } catch (error) {
      setDesktopMsg(error instanceof Error ? error.message : String(error))
    } finally {
      setDesktopBusy(false)
    }
  }, [desktopStatus?.notificationPermission, updateSettings])

  const handlePickSyncFolder = useCallback(async () => {
    try {
      const folder = await dbPickSyncFolder()
      if (folder) updateField('syncFolder', folder)
    } catch (error) {
      setSyncMsg(error instanceof Error ? error.message : String(error))
    }
  }, [updateField])

  const handleSync = useCallback(async () => {
    if (!localSettings.syncFolder.trim()) {
      setSyncMsg('请先选择同步目录')
      return
    }
    if (localSettings.syncPassword.length < 8) {
      setSyncMsg('同步密码至少需要 8 个字符')
      return
    }
    if (!localSettings.syncDeviceId.trim()) {
      setSyncMsg('请填写当前设备名称')
      return
    }
    setSyncBusy(true)
    setSyncMsg(null)
    try {
      const result = await dbSyncWithFolder({
        folder: localSettings.syncFolder,
        password: localSettings.syncPassword,
        deviceId: localSettings.syncDeviceId,
      })
      if (!result) throw new Error('仅桌面版支持目录同步')
      await reloadFromSqlite()
      const lastSyncAt = new Date().toISOString()
      const syncSettings = {
        syncFolder: localSettings.syncFolder,
        syncPassword: localSettings.syncPassword,
        syncDeviceId: localSettings.syncDeviceId,
        lastSyncAt,
      }
      setLocalSettings(current => ({ ...current, ...syncSettings }))
      updateSettings(syncSettings)
      setSyncMsg(`同步完成：新增 ${result.importedActivities} 条活动、${result.importedReports} 份报告，发现 ${result.conflicts} 个冲突`)
    } catch (error) {
      setSyncMsg(error instanceof Error ? error.message : String(error))
    } finally {
      setSyncBusy(false)
    }
  }, [localSettings.syncDeviceId, localSettings.syncFolder, localSettings.syncPassword, reloadFromSqlite, updateSettings])

  /* P1优化: 数据源切换 */
  const dataSourceOptions = [
    { value: 'llm' as const, label: '有 LLM', desc: '读取窗口文本并用模型识别活动，报告也可由模型生成' },
    { value: 'local' as const, label: '无 LLM', desc: '只用本地规则记录活动，报告按固定格式生成，不需要 API' },
  ]

  const backgroundPresets: { value: BackgroundPreset; label: string; desc: string }[] = [
    { value: 'plain', label: '纯色', desc: '简洁纯色背景' },
    { value: 'mint', label: '薄荷绿', desc: '柔和绿色渐变' },
    { value: 'sky', label: '天空蓝', desc: '宁静蓝色渐变' },
    { value: 'graphite', label: '石墨灰', desc: '中性灰色渐变' },
    { value: 'custom', label: '自定义图片', desc: '上传本地背景图' },
  ]

  const themeModes: { value: ThemeMode; label: string }[] = [
    { value: 'system', label: '跟随系统' },
    { value: 'light', label: '浅色' },
    { value: 'dark', label: '深色' },
  ]

  return (
    <div className="space-y-6">
      {/* P1优化: 基础设置区 - 层级2：标准卡片 */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-h3 font-semibold text-ink mb-4">基础设置</h2>

        {/* 数据源选择 - 单选按钮组 */}
        <fieldset className="mb-5">
          <legend className="text-sm font-medium text-ink-muted mb-2">数据来源</legend>
          
          <div className="space-y-2">
            {dataSourceOptions.map(opt => (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  localSettings.dataSource === opt.value
                    ? 'border-accent bg-accent-soft'
                    : 'border-line hover:border-line-strong hover:bg-sunken'
                }`}
              >
                <input
                  type="radio"
                  name="dataSource"
                  value={opt.value}
                  checked={localSettings.dataSource === opt.value}
                  onChange={e => updateField('dataSource', e.target.value as DataSource)}
                  className="mt-0.5 h-4 w-4 text-accent-ink focus:ring-accent"
                />
                <div>
                  <span className="text-sm font-medium text-ink">{opt.label}</span>
                  <p className="text-xs text-ink-muted mt-0.5">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </fieldset>

        {/* API配置 - 条件渲染 */}
        {localSettings.dataSource !== 'local' && (
          <div className="space-y-4 rounded-lg bg-sunken p-4">
            <div>
              <label htmlFor="api-key" className="block text-sm font-medium text-ink-muted mb-1">
                API Key
              </label>
              <input
                id="api-key"
                type="password"
                value={localSettings.apiKey}
                onChange={e => updateField('apiKey', e.target.value)}
                placeholder="输入你的 API Key"
                className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent-soft"
              />
            </div>

            <div>
              <label htmlFor="base-url" className="block text-sm font-medium text-ink-muted mb-1">
                Base URL
              </label>
              <input
                id="base-url"
                type="url"
                value={localSettings.baseUrl}
                onChange={e => updateField('baseUrl', e.target.value)}
                placeholder="https://api.openai.com/v1（任何 OpenAI 兼容服务）"
                className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent-soft"
              />
            </div>

            <div>
              <label htmlFor="text-model" className="block text-sm font-medium text-ink-muted mb-1">
                模型名称
              </label>
              <input
                id="text-model"
                type="text"
                value={localSettings.textModel}
                onChange={e => updateField('textModel', e.target.value)}
                placeholder="如 gpt-4o-mini / deepseek-chat"
                className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent-soft"
              />
              <p className="mt-1 text-xs text-ink-faint">任何兼容 OpenAI 接口的纯文本对话模型均可</p>
            </div>

            {/* 连接测试按钮 + 结果显示 */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTestingConnection
                  || !localSettings.apiKey.trim()
                  || !localSettings.baseUrl.trim()
                  || !localSettings.textModel.trim()}
                className="rounded-md border border-line-strong bg-surface px-4 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:border-accent hover:text-accent-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isTestingConnection ? '测试中...' : '测试连接'}
              </button>

              {connectionTestResult && (
                <span className={`text-xs font-medium ${
                  connectionTestResult.ok ? 'text-accent-ink' : 'text-danger-ink'
                }`}>
                  {connectionTestResult.ok ? '✓ 连接成功' : `✗ ${connectionTestResult.message}`}
                </span>
              )}
            </div>
          </div>
        )}

        {localSettings.dataSource === 'local' && (
          <div className="rounded-lg border border-accent-soft bg-accent-soft p-4 text-sm text-accent-ink">
            无 LLM 模式使用本地分类规则，不发送窗口内容。ActivityWatch 由墨记内置并随应用自动运行，无需安装或配置。
          </div>
        )}
      </section>

      <ClassificationRulesEditor
        rules={localSettings.classificationRules}
        onChange={rules => updateField('classificationRules', rules)}
      />

      {/* 采集行为 */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-h3 font-semibold text-ink mb-4">采集行为</h2>

        <fieldset className="mb-4">
          <legend className="text-sm font-medium text-ink-muted mb-2">采集间隔</legend>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { sec: 60, label: '1 分钟' },
              { sec: 120, label: '2 分钟' },
              { sec: 300, label: '5 分钟' },
              { sec: 600, label: '10 分钟' },
            ].map(opt => (
              <button
                key={opt.sec}
                type="button"
                onClick={() => updateField('intervalSeconds', opt.sec)}
                className={`rounded-lg border px-3 py-2 text-sm transition-all ${
                  localSettings.intervalSeconds === opt.sec
                    ? 'border-accent bg-accent-soft text-accent-ink'
                    : 'border-line hover:border-line-strong hover:bg-sunken'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mb-4">
          <legend className="text-sm font-medium text-ink-muted mb-2">每轮分析窗口数</legend>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 5, 8].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => updateField('maxWindowsPerCapture', n)}
                className={`rounded-lg border px-3 py-2 text-sm transition-all ${
                  localSettings.maxWindowsPerCapture === n
                    ? 'border-accent bg-accent-soft text-accent-ink'
                    : 'border-line hover:border-line-strong hover:bg-sunken'
                }`}
              >
                {n} 个
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-ink-faint">前台窗口优先，自动跳过重复应用</p>
        </fieldset>

        <fieldset className="mb-4">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
            <div>
              <p className="text-sm font-medium text-ink">启动时自动开始采集</p>
              <p className="text-xs text-ink-muted">打开应用后自动进入定时采集</p>
            </div>
            <input
              type="checkbox"
              checked={localSettings.autoStart}
              onChange={e => updateField('autoStart', e.target.checked)}
              className="h-4 w-4 accent-brand-600"
            />
          </div>
        </fieldset>

        <fieldset className="mb-4">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
            <div>
              <p className="text-sm font-medium text-ink">保存截图缩略图</p>
              <p className="text-xs text-ink-muted">开启后才会截屏，并在记录里保存压缩缩略图；关闭时识别完全基于窗口文本</p>
            </div>
            <input
              type="checkbox"
              checked={localSettings.saveScreenshotThumbnails}
              onChange={e => updateField('saveScreenshotThumbnails', e.target.checked)}
              className="h-4 w-4 accent-brand-600"
            />
          </div>
        </fieldset>

        <fieldset className="mb-4">
          <legend className="mb-2 text-sm font-medium text-ink-muted">空闲判定</legend>
          <div className="grid grid-cols-5 rounded-lg border border-line bg-sunken p-1">
            {[1, 3, 5, 10, 15].map(minutes => (
              <button
                key={minutes}
                type="button"
                aria-pressed={localSettings.idleThresholdMinutes === minutes}
                onClick={() => updateField('idleThresholdMinutes', minutes)}
                className={`min-h-8 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                  localSettings.idleThresholdMinutes === minutes
                    ? 'bg-surface text-ink shadow-sm ring-1 ring-line'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {minutes} 分
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-ink-muted">锁屏立即暂停；达到阈值前会从本次活动中扣除空闲秒数</p>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink-muted">可选上下文</legend>
          <div className="divide-y divide-line rounded-lg border border-line">
            <label className="flex items-center justify-between gap-3 p-3">
              <span>
                <span className="block text-sm font-medium text-ink">浏览器域名</span>
                <span className="block text-xs text-ink-muted">只保存域名，不保存完整网址</span>
              </span>
              <input
                type="checkbox"
                checked={localSettings.captureBrowserDomains}
                onChange={event => updateField('captureBrowserDomains', event.target.checked)}
                className="h-4 w-4 accent-brand-600"
              />
            </label>
            <label className="flex items-center justify-between gap-3 p-3">
              <span>
                <span className="block text-sm font-medium text-ink">IDE 项目名</span>
                <span className="block text-xs text-ink-muted">从窗口标题提取项目名，不保存文件内容</span>
              </span>
              <input
                type="checkbox"
                checked={localSettings.captureIdeProjects}
                onChange={event => updateField('captureIdeProjects', event.target.checked)}
                className="h-4 w-4 accent-brand-600"
              />
            </label>
          </div>
        </fieldset>
      </section>

      {/* 隐私排除 */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-h3 font-semibold text-ink mb-4">隐私排除</h2>

        <fieldset className="mb-4">
          <label htmlFor="excluded-keywords" className="block text-sm font-medium text-ink-muted mb-1">
            排除应用/窗口关键词
          </label>
          <textarea
            id="excluded-keywords"
            rows={3}
            value={localSettings.excludedKeywords.join('\n')}
            onChange={e => updateField('excludedKeywords', e.target.value.split(/[\n,，]/).map(s => s.trim()).filter(Boolean))}
            placeholder={'Password\nToken\nBank'}
            className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent-soft"
          />
          <p className="mt-1 text-xs text-ink-faint">每行或逗号分隔；命中的窗口不会发送给 AI</p>
        </fieldset>

        <fieldset className="mb-4">
          <label htmlFor="excluded-apps" className="block text-sm font-medium text-ink-muted mb-1">
            排除应用
          </label>
          <textarea
            id="excluded-apps"
            rows={2}
            value={localSettings.excludedApps.join('\n')}
            onChange={e => updateField('excludedApps', e.target.value.split(/[\n,，]/).map(s => s.trim()).filter(Boolean))}
            placeholder={'1password\nBitwarden'}
            className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent-soft"
          />
          <p className="mt-1 text-xs text-ink-faint">按进程名匹配，命中的窗口不采集</p>
        </fieldset>

        <fieldset>
          <label htmlFor="excluded-titles" className="block text-sm font-medium text-ink-muted mb-1">
            排除标题关键词
          </label>
          <textarea
            id="excluded-titles"
            rows={2}
            value={localSettings.excludedTitlePatterns.join('\n')}
            onChange={e => updateField('excludedTitlePatterns', e.target.value.split(/[\n,，]/).map(s => s.trim()).filter(Boolean))}
            placeholder={'Lock Screen\nLogin'}
            className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent-soft"
          />
          <p className="mt-1 text-xs text-ink-faint">标题包含这些关键词的窗口会跳过</p>
        </fieldset>
      </section>

      {/* P1优化: 外观设置 - 层级2：标准卡片 */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-h3 font-semibold text-ink mb-4">外观与主题</h2>

        <fieldset className="mb-4">
          <legend className="mb-2 text-sm font-medium text-ink-muted">颜色模式</legend>
          <div className="grid grid-cols-3 rounded-lg border border-line bg-sunken p-1">
            {themeModes.map(mode => (
              <button
                key={mode.value}
                type="button"
                aria-pressed={localSettings.appearance?.themeMode === mode.value}
                onClick={() => updateField('appearance', {
                  ...localSettings.appearance,
                  themeMode: mode.value,
                })}
                className={`min-h-8 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                  localSettings.appearance?.themeMode === mode.value
                    ? 'bg-surface text-ink shadow-sm ring-1 ring-line'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-ink-faint">跟随系统会在 Windows 主题变化时自动切换</p>
        </fieldset>

        {/* 背景预设选择 - 卡片网格 */}
        <fieldset className="mb-4">
          <legend className="text-sm font-medium text-ink-muted mb-2">背景风格</legend>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {backgroundPresets.map(preset => (
              <button
                key={preset.value}
                type="button"
                onClick={() => updateField('appearance', {
                  ...localSettings.appearance,
                  backgroundPreset: preset.value,
                })}
                className={`relative rounded-lg border-2 p-3 text-left transition-all ${
                  localSettings.appearance?.backgroundPreset === preset.value
                    ? 'border-accent bg-accent-soft'
                    : 'border-line hover:border-line-strong'
                }`}
              >
                {/* 预览色块 */}
                <div 
                  className="mb-2 h-12 w-full rounded-md bg-gradient-to-br"
                  style={{
                    background: getAppearancePreview(
                      preset.value,
                      localSettings.appearance?.themeMode === 'system'
                        ? document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
                        : localSettings.appearance?.themeMode ?? 'light',
                      localSettings.appearance?.customBackground,
                    ),
                  }}
                />
                <span className="text-xs font-medium text-ink block">{preset.label}</span>
                <span className="text-[10px] text-ink-muted block mt-0.5">{preset.desc}</span>
                
                {/* 选中指示器 */}
                {localSettings.appearance?.backgroundPreset === preset.value && (
                  <span className="absolute top-1.5 right-1.5 h-4 w-4 rounded-full bg-accent flex items-center justify-center">
                    <svg className="h-2.5 w-2.5 text-on-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                )}
              </button>
            ))}
          </div>
        </fieldset>

        {/* 自定义背景上传 */}
        {localSettings.appearance?.backgroundPreset === 'custom' && (
          <div className="rounded-lg border border-dashed border-line-strong p-4 text-center">
            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => {
                  const result = reader.result as string
                  updateField('appearance', {
                    ...localSettings.appearance,
                    customBackground: result,
                  })
                }
                reader.readAsDataURL(file)
              }}
              className="hidden"
              id="custom-bg-upload"
            />
            <label
              htmlFor="custom-bg-upload"
              className="cursor-pointer inline-flex items-center gap-2 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink-muted hover:bg-sunken"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              选择图片
            </label>
            {localSettings.appearance?.customBackground && (
              <p className="mt-2 text-xs text-ok-ink">✓ 已设置自定义背景</p>
            )}
          </div>
        )}
      </section>

      {/* P1优化: 数据管理 - 层级2：标准卡片 */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-h3 font-semibold text-ink mb-4">数据管理</h2>

        <div className="space-y-3">
          {/* 导入导出按钮组 */}
          <div className="flex flex-wrap gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-ink-muted transition-colors hover:border-accent hover:text-accent-ink">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              导入 JSON
              <input
                type="file"
                accept=".json,.md,.markdown,application/json,text/markdown"
                onChange={handleImportFile}
                className="hidden"
              />
            </label>

            <button
              type="button"
              onClick={handleExport}
              className="inline-flex items-center gap-2 rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-ink-muted transition-colors hover:border-accent hover:text-accent-ink"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              导出 JSON
            </button>
            <button
              type="button"
              onClick={() => void handleExportDiagnostics()}
              className="inline-flex items-center gap-2 rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-ink-muted transition-colors hover:border-accent hover:text-accent-ink"
              title="不包含活动、窗口标题、截图或 API 配置值"
            >
              导出脱敏诊断
            </button>
          </div>
          <p className="text-xs leading-5 text-ink-muted">诊断文件只包含运行模式、采集参数计数、服务状态和本次会话错误，不包含活动内容、窗口标题、截图或 API 配置值。</p>

          {/* 危险区域：清空数据 */}
          <div className="mt-4 rounded-lg border border-danger-line bg-danger-soft p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-medium text-danger-ink">危险操作</h3>
                <p className="mt-0.5 text-xs text-danger-ink">
                  清空所有活动记录，此操作不可恢复
                </p>
              </div>
              <button
                type="button"
                onClick={handleClearAll}
                className="shrink-0 rounded-md border border-danger-line bg-surface px-3 py-1.5 text-xs font-medium text-danger-ink transition-colors hover:bg-danger-soft hover:border-danger-line"
              >
                清空全部数据
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 数据库与备份 */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-h3 font-semibold text-ink mb-4">数据库与备份</h2>
        <div className="mb-4 space-y-1 rounded-lg border border-line bg-sunken px-3 py-2 text-xs text-ink-muted">
          <p>状态：{dbStatus ?? (sqliteReady ? '检测中…' : '未连接')}</p>
          {storageStats && <p>占用：{formatBytes(storageStats.database_bytes)} · {storageStats.activity_count} 条活动 · {storageStats.screenshot_count} 张缩略图</p>}
          <p>本地备份文件：{backupExists ? '已存在' : '尚无'}</p>
          <p>自动备份：就绪后每 30 秒写入一次</p>
        </div>
        <div className="mb-4 grid gap-3 border-y border-line py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="text-sm font-medium text-ink-muted">
            数据保留期限
            <select
              value={localSettings.retentionDays}
              onChange={event => updateField('retentionDays', Number(event.target.value))}
              className="mt-1 block w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
            >
              <option value={0}>永久保留</option>
              <option value={30}>30 天</option>
              <option value={90}>90 天</option>
              <option value={180}>180 天</option>
              <option value={365}>365 天</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void handleCleanupExpired()}
            disabled={backupBusy || localSettings.retentionDays === 0 || !storageStats?.expired_count}
            className="rounded-md border border-danger-line bg-surface px-3 py-2 text-sm font-medium text-danger-ink hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            清理 {storageStats?.expired_count ?? 0} 条过期活动
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleBackupNow()}
            disabled={backupBusy || !sqliteReady}
            className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:border-accent hover:text-accent-ink disabled:opacity-50"
          >
            {backupBusy ? '处理中…' : '立即备份'}
          </button>
          <button
            type="button"
            onClick={() => void handleRestoreBackup()}
            disabled={backupBusy || !sqliteReady || !backupExists}
            className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:border-accent hover:text-accent-ink disabled:opacity-50"
          >
            从备份恢复
          </button>
          <button
            type="button"
            onClick={() => void refreshDbInfo()}
            disabled={backupBusy}
            className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:border-accent hover:text-accent-ink disabled:opacity-50"
          >
            刷新诊断
          </button>
        </div>
        {backupMsg && <p className="mt-2 text-xs text-ink-muted">{backupMsg}</p>}
      </section>

      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-h3 font-semibold text-ink">桌面集成</h2>
            <p className="mt-1 text-xs text-ink-muted">系统级能力均默认关闭，可随时单独撤销</p>
          </div>
          <button
            type="button"
            onClick={() => void refreshPlatformInfo()}
            disabled={desktopBusy}
            className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted disabled:opacity-50"
          >
            刷新状态
          </button>
        </div>
        <div className="divide-y divide-line-soft rounded-lg border border-line px-4">
          <label className="flex items-center justify-between gap-4 py-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">开机自启</span>
              <span className="mt-0.5 block text-xs text-ink-muted">登录系统后启动墨记</span>
            </span>
            <input
              type="checkbox"
              checked={desktopStatus?.autostartEnabled ?? localSettings.launchAtLogin}
              onChange={event => void handleAutostartChange(event.target.checked)}
              disabled={desktopBusy || !desktopStatus}
              className="h-4 w-4 accent-brand-600"
            />
          </label>
          <label className="flex items-center justify-between gap-4 py-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">显示／隐藏快捷键</span>
              <span className="mt-0.5 block break-all text-xs text-ink-muted">{desktopStatus?.shortcut ?? 'CommandOrControl+Shift+M'}</span>
            </span>
            <input
              type="checkbox"
              checked={desktopStatus?.shortcutEnabled ?? localSettings.globalShortcutEnabled}
              onChange={event => void handleShortcutChange(event.target.checked)}
              disabled={desktopBusy || !desktopStatus}
              className="h-4 w-4 accent-brand-600"
            />
          </label>
          <label className="flex items-center justify-between gap-4 py-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">系统通知</span>
              <span className="mt-0.5 block text-xs text-ink-muted">权限：{desktopStatus?.notificationPermission ?? '未检测'}</span>
            </span>
            <input
              type="checkbox"
              checked={localSettings.systemNotificationsEnabled}
              onChange={event => void handleNotificationChange(event.target.checked)}
              disabled={desktopBusy || !desktopStatus}
              className="h-4 w-4 accent-brand-600"
            />
          </label>
        </div>
        {desktopMsg && <p className="mt-3 text-xs text-warn-ink">{desktopMsg}</p>}
      </section>

      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <div className="mb-4">
          <h2 className="text-h3 font-semibold text-ink">加密目录同步</h2>
          <p className="mt-1 text-xs text-ink-muted">快照使用 AES-256-GCM 加密；同步前自动备份本地数据库</p>
        </div>
        <div className="space-y-3">
          <label className="block text-sm font-medium text-ink-muted">
            同步目录
            <div className="mt-1 flex gap-2">
              <input
                value={localSettings.syncFolder}
                readOnly
                placeholder="选择 OneDrive、坚果云或 Syncthing 中的目录"
                className="min-w-0 flex-1 rounded-md border border-line-strong bg-sunken px-3 py-2 text-sm text-ink"
              />
              <button
                type="button"
                onClick={() => void handlePickSyncFolder()}
                disabled={syncBusy}
                className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-ink-muted disabled:opacity-50"
              >
                选择目录
              </button>
            </div>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-ink-muted">
              同步密码
              <input
                type="password"
                autoComplete="new-password"
                value={localSettings.syncPassword}
                onChange={event => updateField('syncPassword', event.target.value)}
                placeholder="至少 8 个字符"
                className="mt-1 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="text-sm font-medium text-ink-muted">
              当前设备名称
              <input
                value={localSettings.syncDeviceId}
                onChange={event => updateField('syncDeviceId', event.target.value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48))}
                placeholder="例如 office-pc"
                className="mt-1 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-3">
            <p className="text-xs text-ink-muted">
              {localSettings.lastSyncAt ? `上次同步：${new Date(localSettings.lastSyncAt).toLocaleString('zh-CN')}` : '尚未同步'}
            </p>
            <button
              type="button"
              onClick={() => void handleSync()}
              disabled={syncBusy || !sqliteReady}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
            >
              {syncBusy ? '同步中…' : '立即同步'}
            </button>
          </div>
          {syncMsg && <p className="text-xs leading-5 text-ink-muted">{syncMsg}</p>}
          <p className="text-[11px] leading-5 text-ink-faint">密码只保存在当前设备，不写入快照；忘记密码后无法读取已有同步文件。</p>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <div className="mb-4">
          <h2 className="text-h3 font-semibold text-ink">数据源状态</h2>
          <p className="mt-1 text-xs text-ink-muted">所有数据源先标准化，再进入同一套本地分类和去重流程</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {activitySources.map(source => (
            <div key={source.id} className="border-l-3 border-line bg-sunken px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink">{source.label}</p>
                <span className={`text-[11px] font-medium ${source.available ? 'text-ok-ink' : 'text-warn-ink'}`}>
                  {source.available ? '可用' : '受限'}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-ink-muted">{source.detail}</p>
              <p className="mt-1 text-[11px] leading-5 text-ink-faint">{source.privacy}</p>
            </div>
          ))}
          {activitySources.length === 0 && <p className="text-xs text-ink-muted">请在桌面版中查看数据源能力。</p>}
        </div>
      </section>

      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-h3 font-semibold text-ink">本地 MCP</h2>
            <p className="mt-1 text-xs text-ink-muted">按需由 MCP 客户端启动，只提供只读查询工具</p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!mcpInfo) return
              const config = { command: mcpInfo.executable, args: mcpInfo.args, env: { MOJI_DB_PATH: mcpInfo.databasePath } }
              void navigator.clipboard.writeText(JSON.stringify(config, null, 2))
            }}
            disabled={!mcpInfo}
            className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted disabled:opacity-50"
          >
            复制配置
          </button>
        </div>
        {mcpInfo ? (
          <div className="space-y-2 text-xs text-ink-muted">
            <p className="break-all"><span className="text-ink-faint">程序：</span>{mcpInfo.executable}</p>
            <p className="break-all"><span className="text-ink-faint">数据库：</span>{mcpInfo.databasePath}</p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {mcpInfo.tools.map(tool => <code key={tool} className="bg-sunken px-2 py-1 text-[11px] text-ink-muted">{tool}</code>)}
            </div>
          </div>
        ) : <p className="text-xs text-ink-muted">请在桌面版中读取 MCP 配置。</p>}
      </section>

      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-h3 font-semibold text-ink">本地只读 API</h2>
            <p className="mt-1 text-xs text-ink-muted">仅监听本机回环地址，所有端点均需访问令牌</p>
          </div>
          <input
            type="checkbox"
            checked={localSettings.localApiEnabled}
            onChange={event => {
              const enabled = event.target.checked
              updateField('localApiEnabled', enabled)
              if (enabled && localSettings.localApiToken.length < 24) {
                updateField('localApiToken', generateLocalApiToken())
              }
            }}
            aria-label="启用本地只读 API"
            className="mt-1 h-4 w-4 accent-brand-600"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
          <label className="text-sm font-medium text-ink-muted">
            端口
            <input
              type="number"
              min="1024"
              max="65535"
              value={localSettings.localApiPort}
              onChange={event => updateField('localApiPort', Math.min(65535, Math.max(1024, Number(event.target.value) || 5610)))}
              disabled={!localSettings.localApiEnabled}
              className="mt-1 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink disabled:bg-sunken"
            />
          </label>
          <label className="text-sm font-medium text-ink-muted">
            访问令牌
            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <input
                type="password"
                value={localSettings.localApiToken}
                onChange={event => updateField('localApiToken', event.target.value)}
                disabled={!localSettings.localApiEnabled}
                className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-xs text-ink disabled:bg-sunken"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => updateField('localApiToken', generateLocalApiToken())}
                  disabled={!localSettings.localApiEnabled}
                  className="flex-1 rounded-md border border-line-strong bg-surface px-3 py-2 text-xs font-medium text-ink-muted disabled:opacity-50 sm:flex-none"
                >
                  重新生成
                </button>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(localSettings.localApiToken)}
                  disabled={!localSettings.localApiToken}
                  className="flex-1 rounded-md border border-line-strong bg-surface px-3 py-2 text-xs font-medium text-ink-muted disabled:opacity-50 sm:flex-none"
                >
                  复制
                </button>
              </div>
            </div>
          </label>
        </div>

        <div className="mt-4 border-t border-line pt-3 text-xs text-ink-muted">
          <p>状态：{localApiStatus?.running ? `运行于 127.0.0.1:${localApiStatus.port}` : '未运行'}</p>
          <p className="mt-1 font-mono">GET /health · /v1/activities · /v1/summary</p>
        </div>
      </section>

      {/* P1优化: 保存按钮 - 固定底栏风格 */}
      {hasUnsavedChanges && (
        <div className="sticky bottom-16 z-20 rounded-lg border border-accent bg-accent-soft p-3 shadow-card">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-accent-ink">有未保存的更改</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setLocalSettings(settings)
                  setHasUnsavedChanges(false)
                }}
                className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-sunken"
              >
                放弃
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover transition-colors"
              >
                保存更改
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
