import { useCallback, useEffect, useState } from 'react'
import { useActivityStore } from '../stores/activityStore'
import type { BackgroundPreset } from '../stores/activityStore'
import {
  dbDiagnoseDb,
  dbLoadBackup,
  dbRestoreBackupToDb,
  dbSaveBackup,
} from '../utils/db'

/* P1优化: 设置页 - 使用层级化表单设计 */

export function Settings() {
  const {
    settings,
    updateSettings,
    testAiConnection,
    connectionTestResult,
    syncFromAw,
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
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // 同步外部设置变化到本地状态
  useEffect(() => {
    setLocalSettings(settings)
    setHasUnsavedChanges(false)
  }, [settings])

  // 挂载时刷新数据库诊断信息
  useEffect(() => {
    void (async () => {
      const diag = await dbDiagnoseDb()
      const hasBackup = await dbLoadBackup()
      setDbStatus(diag ?? 'SQLite 已连接')
      setBackupExists(Boolean(hasBackup))
    })()
  }, [])

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
    updateSettings(localSettings)
    setHasUnsavedChanges(false)
  }, [localSettings, updateSettings])

  /* P1优化: 测试连接 */
  const handleTestConnection = useCallback(async () => {
    setIsTestingConnection(true)
    try {
      await testAiConnection()
    } catch (err) {
      console.error('连接测试失败:', err)
    } finally {
      setIsTestingConnection(false)
    }
  }, [testAiConnection])

  /* 数据库备份/恢复 */
  const refreshDbInfo = useCallback(async () => {
    const diag = await dbDiagnoseDb()
    const hasBackup = await dbLoadBackup()
    setDbStatus(diag ?? 'SQLite 已连接')
    setBackupExists(Boolean(hasBackup))
  }, [])

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
      const data = JSON.parse(text)
      await importActivitiesFromJson(data)
      e.target.value = '' // 重置input
    } catch (err) {
      console.error('导入失败:', err)
      alert('导入失败：请检查文件格式是否正确')
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
      a.download = `moji-activities-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('导出失败:', err)
    }
  }, [exportActivitiesAsJson])

  /* P1优化: 清空确认 */
  const handleClearAll = useCallback(async () => {
    if (!confirm('确定要清空所有活动记录吗？此操作不可恢复！')) return
    try {
      await clearAllActivities()
    } catch (err) {
      console.error('清空失败:', err)
    }
  }, [clearAllActivities])

  /* P1优化: 数据源切换 */
  const dataSourceOptions = [
    { value: 'window_text' as const, label: '窗口文本 + AI 识别', desc: '本地读取窗口文本识别活动，不截图' },
    { value: 'aw' as const, label: 'ActivityWatch', desc: '从 AW 同步桌面活动数据' },
    { value: 'both' as const, label: '双源并行', desc: '窗口文本 AI 识别 + AW 时间线同时采集，去重合并' },
  ]

  const backgroundPresets: { value: BackgroundPreset; label: string; desc: string }[] = [
    { value: 'plain', label: '纯色', desc: '默认浅灰背景' },
    { value: 'mint', label: '薄荷绿', desc: '清新淡绿渐变' },
    { value: 'sky', label: '天空蓝', desc: '宁静蓝色渐变' },
    { value: 'graphite', label: '石墨灰', desc: '专业灰色渐变' },
    { value: 'custom', label: '自定义图片', desc: '上传本地背景图' },
  ]

  return (
    <div className="space-y-6">
      {/* P1优化: 基础设置区 - 层级2：标准卡片 */}
      <section className="rounded-xl border border-gray-200/60 bg-white p-5 shadow-sm">
        <h2 className="text-h3 font-semibold text-gray-900 mb-4">基础设置</h2>

        {/* 数据源选择 - 单选按钮组 */}
        <fieldset className="mb-5">
          <legend className="text-sm font-medium text-gray-700 mb-2">数据来源</legend>
          
          <div className="space-y-2">
            {dataSourceOptions.map(opt => (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  localSettings.dataSource === opt.value
                    ? 'border-brand-300 bg-brand-50/30'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="dataSource"
                  value={opt.value}
                  checked={localSettings.dataSource === opt.value}
                  onChange={e => updateField('dataSource', e.target.value as 'window_text' | 'aw')}
                  className="mt-0.5 h-4 w-4 text-brand-600 focus:ring-brand-500"
                />
                <div>
                  <span className="text-sm font-medium text-gray-900">{opt.label}</span>
                  <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </fieldset>

        {/* API配置 - 条件渲染 */}
        {localSettings.dataSource !== 'aw' && (
          <div className="space-y-4 rounded-lg bg-gray-50/50 p-4">
            <div>
              <label htmlFor="api-key" className="block text-sm font-medium text-gray-700 mb-1">
                API Key
              </label>
              <input
                id="api-key"
                type="password"
                value={localSettings.apiKey}
                onChange={e => updateField('apiKey', e.target.value)}
                placeholder="输入你的 API Key"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-100"
              />
            </div>

            <div>
              <label htmlFor="base-url" className="block text-sm font-medium text-gray-700 mb-1">
                Base URL
              </label>
              <input
                id="base-url"
                type="url"
                value={localSettings.baseUrl}
                onChange={e => updateField('baseUrl', e.target.value)}
                placeholder="https://api.example.com/v1"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-100"
              />
            </div>

            {/* 连接测试按钮 + 结果显示 */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTestingConnection || !localSettings.apiKey.trim()}
                className="rounded-md border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-500 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isTestingConnection ? '测试中...' : '测试连接'}
              </button>

              {connectionTestResult && (
                <span className={`text-xs font-medium ${
                  connectionTestResult.ok ? 'text-teal-600' : 'text-red-600'
                }`}>
                  {connectionTestResult.ok ? '✓ 连接成功' : `✗ ${connectionTestResult.message}`}
                </span>
              )}
            </div>
          </div>
        )}

        {/* AW同步配置 */}
        {localSettings.dataSource !== 'window_text' && (
          <div className="space-y-4 rounded-lg bg-teal-50/30 p-4 border border-teal-100">
            <div>
              <label htmlFor="aw-host" className="block text-sm font-medium text-gray-700 mb-1">
                AW 服务地址
              </label>
              <input
                id="aw-host"
                type="text"
                value={localSettings.awHost || ''}
                onChange={e => updateField('awHost', e.target.value)}
                placeholder="localhost:5600"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-100"
              />
              <p className="mt-1 text-xs text-gray-500">
                ActivityWatch 默认端口 5600，确保服务已启动
              </p>
            </div>

            <div>
              <label htmlFor="aw-sync-minutes" className="block text-sm font-medium text-gray-700 mb-1">
                同步间隔（分钟）
              </label>
              <input
                id="aw-sync-minutes"
                type="number"
                min={1}
                max={60}
                value={localSettings.awSyncMinutes || 5}
                onChange={e => updateField('awSyncMinutes', parseInt(e.target.value) || 5)}
                className="w-full max-w-[120px] rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-100"
              />
            </div>

            <button
              type="button"
              onClick={() => syncFromAw().catch(() => {})}
              className="rounded-md bg-teal-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-700 transition-colors"
            >
              立即同步测试
            </button>
          </div>
        )}
      </section>

      {/* 采集行为 */}
      <section className="rounded-xl border border-gray-200/60 bg-white p-5 shadow-sm">
        <h2 className="text-h3 font-semibold text-gray-900 mb-4">采集行为</h2>

        <fieldset className="mb-4">
          <legend className="text-sm font-medium text-gray-700 mb-2">采集间隔</legend>
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
                    ? 'border-brand-500 bg-brand-50/30 text-brand-700'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mb-4">
          <legend className="text-sm font-medium text-gray-700 mb-2">每轮分析窗口数</legend>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 5, 8].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => updateField('maxWindowsPerCapture', n)}
                className={`rounded-lg border px-3 py-2 text-sm transition-all ${
                  localSettings.maxWindowsPerCapture === n
                    ? 'border-brand-500 bg-brand-50/30 text-brand-700'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                {n} 个
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-400">前台窗口优先，自动跳过重复应用</p>
        </fieldset>

        <fieldset className="mb-4">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-3">
            <div>
              <p className="text-sm font-medium text-gray-900">启动时自动开始采集</p>
              <p className="text-xs text-gray-500">打开应用后自动进入定时采集</p>
            </div>
            <input
              type="checkbox"
              checked={localSettings.autoStart}
              onChange={e => updateField('autoStart', e.target.checked)}
              className="h-4 w-4 accent-brand-600"
            />
          </div>
        </fieldset>

        <fieldset>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-3">
            <div>
              <p className="text-sm font-medium text-gray-900">保存截图缩略图</p>
              <p className="text-xs text-gray-500">开启后才会截屏，并在记录里保存压缩缩略图；关闭时识别完全基于窗口文本</p>
            </div>
            <input
              type="checkbox"
              checked={localSettings.saveScreenshotThumbnails}
              onChange={e => updateField('saveScreenshotThumbnails', e.target.checked)}
              className="h-4 w-4 accent-brand-600"
            />
          </div>
        </fieldset>
      </section>

      {/* 隐私排除 */}
      <section className="rounded-xl border border-gray-200/60 bg-white p-5 shadow-sm">
        <h2 className="text-h3 font-semibold text-gray-900 mb-4">隐私排除</h2>

        <fieldset className="mb-4">
          <label htmlFor="excluded-keywords" className="block text-sm font-medium text-gray-700 mb-1">
            排除应用/窗口关键词
          </label>
          <textarea
            id="excluded-keywords"
            rows={3}
            value={localSettings.excludedKeywords.join('\n')}
            onChange={e => updateField('excludedKeywords', e.target.value.split(/[\n,，]/).map(s => s.trim()).filter(Boolean))}
            placeholder={'Password\nToken\nBank'}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-100"
          />
          <p className="mt-1 text-xs text-gray-400">每行或逗号分隔；命中的窗口不会发送给 AI</p>
        </fieldset>

        <fieldset className="mb-4">
          <label htmlFor="excluded-apps" className="block text-sm font-medium text-gray-700 mb-1">
            排除应用
          </label>
          <textarea
            id="excluded-apps"
            rows={2}
            value={localSettings.excludedApps.join('\n')}
            onChange={e => updateField('excludedApps', e.target.value.split(/[\n,，]/).map(s => s.trim()).filter(Boolean))}
            placeholder={'1password\nBitwarden'}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-100"
          />
          <p className="mt-1 text-xs text-gray-400">按进程名匹配，命中的窗口不采集</p>
        </fieldset>

        <fieldset>
          <label htmlFor="excluded-titles" className="block text-sm font-medium text-gray-700 mb-1">
            排除标题关键词
          </label>
          <textarea
            id="excluded-titles"
            rows={2}
            value={localSettings.excludedTitlePatterns.join('\n')}
            onChange={e => updateField('excludedTitlePatterns', e.target.value.split(/[\n,，]/).map(s => s.trim()).filter(Boolean))}
            placeholder={'Lock Screen\nLogin'}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-100"
          />
          <p className="mt-1 text-xs text-gray-400">标题包含这些关键词的窗口会跳过</p>
        </fieldset>
      </section>

      {/* P1优化: 外观设置 - 层级2：标准卡片 */}
      <section className="rounded-xl border border-gray-200/60 bg-white p-5 shadow-sm">
        <h2 className="text-h3 font-semibold text-gray-900 mb-4">外观与主题</h2>

        {/* 背景预设选择 - 卡片网格 */}
        <fieldset className="mb-4">
          <legend className="text-sm font-medium text-gray-700 mb-2">背景风格</legend>
          
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
                    ? 'border-brand-500 bg-brand-50/20'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {/* 预览色块 */}
                <div 
                  className="mb-2 h-12 w-full rounded-md bg-gradient-to-br"
                  style={{
                    background: getBackgroundPreview(preset.value),
                  }}
                />
                <span className="text-xs font-medium text-gray-900 block">{preset.label}</span>
                <span className="text-[10px] text-gray-500 block mt-0.5">{preset.desc}</span>
                
                {/* 选中指示器 */}
                {localSettings.appearance?.backgroundPreset === preset.value && (
                  <span className="absolute top-1.5 right-1.5 h-4 w-4 rounded-full bg-brand-500 flex items-center justify-center">
                    <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
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
          <div className="rounded-lg border border-dashed border-gray-300 p-4 text-center">
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
              className="cursor-pointer inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              选择图片
            </label>
            {localSettings.appearance?.customBackground && (
              <p className="mt-2 text-xs text-green-600">✓ 已设置自定义背景</p>
            )}
          </div>
        )}
      </section>

      {/* P1优化: 数据管理 - 层级2：标准卡片 */}
      <section className="rounded-xl border border-gray-200/60 bg-white p-5 shadow-sm">
        <h2 className="text-h3 font-semibold text-gray-900 mb-4">数据管理</h2>

        <div className="space-y-3">
          {/* 导入导出按钮组 */}
          <div className="flex flex-wrap gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-brand-500 hover:text-brand-700">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              导入 JSON
              <input
                type="file"
                accept=".json,application/json"
                onChange={handleImportFile}
                className="hidden"
              />
            </label>

            <button
              type="button"
              onClick={handleExport}
              className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-brand-500 hover:text-brand-700"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              导出 JSON
            </button>
          </div>

          {/* 危险区域：清空数据 */}
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50/30 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-medium text-red-800">危险操作</h3>
                <p className="mt-0.5 text-xs text-red-600">
                  清空所有活动记录，此操作不可恢复
                </p>
              </div>
              <button
                type="button"
                onClick={handleClearAll}
                className="shrink-0 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 hover:border-red-400"
              >
                清空全部数据
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 数据库与备份 */}
      <section className="rounded-xl border border-gray-200/60 bg-white p-5 shadow-sm">
        <h2 className="text-h3 font-semibold text-gray-900 mb-4">数据库与备份</h2>
        <div className="mb-4 space-y-1 rounded-lg border border-gray-200 bg-gray-50/50 px-3 py-2 text-xs text-gray-600">
          <p>状态：{dbStatus ?? (sqliteReady ? '检测中…' : '未连接')}</p>
          <p>本地备份文件：{backupExists ? '已存在' : '尚无'}</p>
          <p>自动备份：就绪后每 30 秒写入一次</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleBackupNow()}
            disabled={backupBusy || !sqliteReady}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-500 hover:text-brand-700 disabled:opacity-50"
          >
            {backupBusy ? '处理中…' : '立即备份'}
          </button>
          <button
            type="button"
            onClick={() => void handleRestoreBackup()}
            disabled={backupBusy || !sqliteReady || !backupExists}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-500 hover:text-brand-700 disabled:opacity-50"
          >
            从备份恢复
          </button>
          <button
            type="button"
            onClick={() => void refreshDbInfo()}
            disabled={backupBusy}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-brand-500 hover:text-brand-700 disabled:opacity-50"
          >
            刷新诊断
          </button>
        </div>
        {backupMsg && <p className="mt-2 text-xs text-gray-600">{backupMsg}</p>}
      </section>

      {/* P1优化: 保存按钮 - 固定底栏风格 */}
      {hasUnsavedChanges && (
        <div className="sticky bottom-16 z-20 rounded-lg border border-brand-200 bg-brand-50 p-3 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-brand-800">有未保存的更改</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setLocalSettings(settings)
                  setHasUnsavedChanges(false)
                }}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                放弃
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
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

/* 辅助函数：获取背景预览样式 */
function getBackgroundPreview(preset: BackgroundPreset): string {
  switch (preset) {
    case 'mint': return 'linear-gradient(135deg, #d4f5e9 0%, #e8f5e9 50%, #f0f7f4 100%)'
    case 'sky': return 'linear-gradient(135deg, #dceefb 0%, #e8f0fe 50%, #f0f4f8 100%)'
    case 'graphite': return 'linear-gradient(135deg, #e8eaed 0%, #f1f3f4 50%, #f8f9fa 100%)'
    case 'custom': return 'repeating-conic-gradient(#f3f4f6 0% 25%, #fff 0% 50%) 50% / 10px 10px'
    default: return '#f8fafc'
  }
}
