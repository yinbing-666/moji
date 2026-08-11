import { useEffect, useRef, useState } from 'react'
import { useActivityStore } from '../stores/activityStore'
import { parseImport, mergeImport } from '../utils/importData'
import { exportActivitiesAsJson, exportActivitiesAsCompactMarkdown } from '../utils/export'
import {
  dbDiagnoseDb,
  dbLoadBackup,
  dbRestoreBackupToDb,
  dbSaveBackup,
  dbAwHealth,
  isSqliteAvailable,
} from '../utils/db'

const INTERVAL_OPTIONS = [
  { label: '1 分钟', value: 60 },
  { label: '2 分钟', value: 120 },
  { label: '5 分钟', value: 300 },
  { label: '10 分钟', value: 600 },
]

const WINDOW_LIMIT_OPTIONS = [
  { label: '1 个', value: 1 },
  { label: '2 个', value: 2 },
  { label: '3 个', value: 3 },
  { label: '5 个', value: 5 },
  { label: '8 个', value: 8 },
]

export function Settings() {
  const {
    settings,
    updateSettings,
    activities,
    importActivity,
    reloadFromSqlite,
    sqliteReady,
    syncFromAw,
  } = useActivityStore()
  const [showKey, setShowKey] = useState(false)
  const [draft, setDraft] = useState(settings)
  const [excludedText, setExcludedText] = useState(settings.excludedKeywords.join('\n'))
  const [saved, setSaved] = useState(false)
  const [importStatus, setImportStatus] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [dbStatus, setDbStatus] = useState<string | null>(null)
  const [backupExists, setBackupExists] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMsg, setBackupMsg] = useState<string | null>(null)
  const [awStatus, setAwStatus] = useState<string | null>(null)
  const [awBusy, setAwBusy] = useState(false)
  const [awSyncMsg, setAwSyncMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(settings)
    setExcludedText(settings.excludedKeywords.join('\n'))
  }, [settings])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const available = await isSqliteAvailable()
      if (cancelled) return
      if (!available) {
        setDbStatus('SQLite 不可用（浏览器模式或后端未启动）')
        setBackupExists(false)
        return
      }
      const diag = await dbDiagnoseDb()
      const hasBackup = await dbLoadBackup()
      if (cancelled) return
      setDbStatus(diag ?? 'SQLite 已连接')
      setBackupExists(Boolean(hasBackup))
    })()
    return () => { cancelled = true }
  }, [sqliteReady])

  const handleSave = () => {
    const excludedKeywords = excludedText
      .split(/[\n,，]/)
      .map(keyword => keyword.trim())
      .filter(Boolean)

    updateSettings({
      apiKey: draft.apiKey.trim(),
      baseUrl: draft.baseUrl.trim().replace(/\/+$/, ''),
      analysisModel: draft.analysisModel.trim() || 'qwen3-vl-plus',
      reportModel: draft.reportModel.trim() || 'qwen3.7-max',
      intervalSeconds: draft.intervalSeconds,
      maxWindowsPerCapture: draft.maxWindowsPerCapture,
      autoStart: draft.autoStart,
      excludedKeywords,
      excludedApps: draft.excludedApps,
      excludedTitlePatterns: draft.excludedTitlePatterns,
      saveScreenshotThumbnails: draft.saveScreenshotThumbnails,
      appearance: draft.appearance,
      dataSource: draft.dataSource,
      awHost: draft.awHost.trim() || '127.0.0.1',
      awPort: Number(draft.awPort) || 5600,
      awSyncMinutes: Number(draft.awSyncMinutes) || 5,
    })
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2000)
  }

  const handleTestAw = async () => {
    setAwBusy(true)
    setAwStatus(null)
    try {
      const info = await dbAwHealth({ host: draft.awHost.trim() || '127.0.0.1', port: Number(draft.awPort) || 5600 })
      if (!info) throw new Error('连接失败，请确认 ActivityWatch 已启动')
      setAwStatus(`已连接 ✅ 版本 ${info.version ?? '?'}（${info.hostname ?? '本机'}）`)
    } catch (err) {
      setAwStatus('连接失败 ❌ ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setAwBusy(false)
    }
  }

  const handleSyncAw = async () => {
    setAwBusy(true)
    setAwSyncMsg(null)
    try {
      const added = await syncFromAw()
      setAwSyncMsg(added > 0 ? `同步完成：新增 ${added} 条活动记录 🎉` : '同步完成：没有新记录（可能已同步过）')
    } catch (err) {
      setAwSyncMsg('同步失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setAwBusy(false)
    }
  }

  const handleImportFile = async (file: File) => {
    setImportError(null)
    setImportStatus('解析中...')
    try {
      const text = await file.text()
      const incoming = parseImport(text)
      const { toImport, imported, skipped } = mergeImport(incoming, activities)
      let reallyImported = 0
      for (const item of toImport) {
        if (importActivity(item)) reallyImported++
      }
      setImportStatus(
        `导入完成：${reallyImported} 条新增`
        + (reallyImported !== imported ? `（预计 ${imported}）` : '')
        + `，${skipped} 条跳过（ID 重复）`,
      )
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err))
      setImportStatus(null)
    }
  }

  const refreshDbInfo = async () => {
    const diag = await dbDiagnoseDb()
    const hasBackup = await dbLoadBackup()
    setDbStatus(diag ?? 'SQLite 已连接')
    setBackupExists(Boolean(hasBackup))
  }

  const handleBackupNow = async () => {
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
  }

  const handleRestoreBackup = async () => {
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
  }

  return (
    <div className="max-w-lg space-y-6">
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">AI 服务</h2>
          <p className="mt-1 text-xs text-gray-500">用于截图分析和报告生成，配置只保存在本机。</p>
        </div>

      <div>
        <label htmlFor="api-key" className="block text-sm font-medium text-gray-700 mb-1">
          API Key
        </label>
        <div className="relative">
          <input
            id="api-key"
            type={showKey ? 'text' : 'password'}
            value={draft.apiKey}
            onChange={e => setDraft(d => ({ ...d, apiKey: e.target.value }))}
            placeholder="sk-..."
            className="w-full px-3 py-2 pr-14 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowKey(v => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 text-xs"
          >
            {showKey ? '隐藏' : '显示'}
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          API Key 只保存在本地应用设置中，不要写入代码仓库。
        </p>
      </div>

      <div>
        <label htmlFor="base-url" className="block text-sm font-medium text-gray-700 mb-1">
          Base URL
        </label>
        <input
          id="base-url"
          type="url"
          value={draft.baseUrl}
          onChange={e => setDraft(d => ({ ...d, baseUrl: e.target.value }))}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
        />
        <p className="mt-1 text-xs text-gray-500">
          需要提供兼容 OpenAI 的 /chat/completions 接口。
        </p>
        <div className="mt-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 leading-relaxed">
          截图和活动描述会发送到上面填写的 Base URL 对应的服务方。默认的 tokendance.space 是第三方中转站，请确认信任该服务方后再使用。
        </div>
      </div>

      <div>
        <label htmlFor="analysis-model" className="block text-sm font-medium text-gray-700 mb-1">
          截图分析模型
        </label>
        <input
          id="analysis-model"
          type="text"
          value={draft.analysisModel}
          onChange={e => setDraft(d => ({ ...d, analysisModel: e.target.value }))}
          placeholder="qwen3-vl-plus"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
        />
        <p className="mt-1 text-xs text-gray-500">
          用于识别截图内容，必须是支持图片理解的多模态模型。
        </p>
      </div>

      <div>
        <label htmlFor="report-model" className="block text-sm font-medium text-gray-700 mb-1">
          报告生成模型
        </label>
        <input
          id="report-model"
          type="text"
          value={draft.reportModel}
          onChange={e => setDraft(d => ({ ...d, reportModel: e.target.value }))}
          placeholder="qwen3.7-max"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
        />
        <p className="mt-1 text-xs text-gray-500">
          用于生成日报、周报、月报，普通文本模型即可。
        </p>
      </div>
      </section>

      <section className="space-y-4 border-t border-gray-200 pt-5">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">数据源</h2>
          <p className="mt-1 text-xs text-gray-500">选择活动记录来源：本地 ActivityWatch 秒级监控，或墨记定时截图 + AI 识别。</p>
        </div>

        <div>
          <p className="block text-sm font-medium text-gray-700 mb-2">采集方式</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDraft(d => ({ ...d, dataSource: 'aw' as const }))}
              className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                draft.dataSource === 'aw'
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
              }`}
            >
              ActivityWatch（推荐）
            </button>
            <button
              type="button"
              onClick={() => setDraft(d => ({ ...d, dataSource: 'screenshot' as const }))}
              className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                draft.dataSource === 'screenshot'
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
              }`}
            >
              截图 + AI 识别
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {draft.dataSource === 'aw'
              ? '从本机 ActivityWatch 拉取窗口时间线（秒级、零 API 费用、不上云），适合替代日常截屏。'
              : '定时截屏并调用视觉模型识别活动内容，适合需要细粒度活动描述的场合（消耗 API 额度）。'}
          </p>
        </div>

        {draft.dataSource === 'aw' && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label htmlFor="aw-host" className="block text-xs font-medium text-gray-700 mb-1">AW 地址</label>
                <input
                  id="aw-host"
                  type="text"
                  value={draft.awHost}
                  onChange={e => setDraft(d => ({ ...d, awHost: e.target.value }))}
                  placeholder="127.0.0.1"
                  className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
                />
              </div>
              <div>
                <label htmlFor="aw-port" className="block text-xs font-medium text-gray-700 mb-1">端口</label>
                <input
                  id="aw-port"
                  type="number"
                  value={draft.awPort}
                  onChange={e => setDraft(d => ({ ...d, awPort: Number(e.target.value) }))}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
                />
              </div>
              <div>
                <label htmlFor="aw-sync" className="block text-xs font-medium text-gray-700 mb-1">同步间隔(分钟)</label>
                <input
                  id="aw-sync"
                  type="number"
                  min={1}
                  value={draft.awSyncMinutes}
                  onChange={e => setDraft(d => ({ ...d, awSyncMinutes: Number(e.target.value) }))}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleTestAw}
                disabled={awBusy}
                className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 bg-white text-gray-700 hover:border-gray-400 disabled:opacity-50"
              >
                {awBusy ? '测试中...' : '测试连接'}
              </button>
              <button
                type="button"
                onClick={handleSyncAw}
                disabled={awBusy}
                className="px-3 py-1.5 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {awBusy ? '同步中...' : '立即同步'}
              </button>
            </div>

            {awStatus && <p className="text-xs text-gray-600">{awStatus}</p>}
            {awSyncMsg && <p className="text-xs text-gray-600">{awSyncMsg}</p>}
          </>
        )}
      </section>

      <section className="space-y-4 border-t border-gray-200 pt-5">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">采集行为</h2>
          <p className="mt-1 text-xs text-gray-500">控制截图频率、启动行为和是否保留缩略图。</p>
        </div>

      <div>
        <p className="block text-sm font-medium text-gray-700 mb-2">截图间隔</p>
        <div className="flex flex-wrap gap-2">
          {INTERVAL_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setDraft(d => ({ ...d, intervalSeconds: opt.value }))}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                draft.intervalSeconds === opt.value
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="block text-sm font-medium text-gray-700 mb-2">每轮分析窗口数</p>
        <div className="flex flex-wrap gap-2">
          {WINDOW_LIMIT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setDraft(d => ({ ...d, maxWindowsPerCapture: opt.value }))}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                draft.maxWindowsPerCapture === opt.value
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-gray-500">
          默认 3 个。前台窗口优先，并会跳过重复的应用窗口。
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-700">启动时自动开始截图</p>
          <p className="text-xs text-gray-500">打开应用后自动进入定时截图状态。</p>
        </div>
        <button
          type="button"
          aria-pressed={draft.autoStart}
          onClick={() => setDraft(d => ({ ...d, autoStart: !d.autoStart }))}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
            draft.autoStart ? 'bg-green-600' : 'bg-gray-300'
          }`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            draft.autoStart ? 'translate-x-6' : 'translate-x-1'
          }`} />
        </button>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-700">保存截图缩略图</p>
          <p className="text-xs text-gray-500">默认关闭。打开后会在活动记录里保存压缩后的截图，便于回看。</p>
        </div>
        <button
          type="button"
          aria-pressed={draft.saveScreenshotThumbnails}
          onClick={() => setDraft(d => ({ ...d, saveScreenshotThumbnails: !d.saveScreenshotThumbnails }))}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
            draft.saveScreenshotThumbnails ? 'bg-green-600' : 'bg-gray-300'
          }`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            draft.saveScreenshotThumbnails ? 'translate-x-6' : 'translate-x-1'
          }`} />
        </button>
      </div>
      </section>

      <section className="space-y-4 border-t border-gray-200 pt-5">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">隐私排除</h2>
          <p className="mt-1 text-xs text-gray-500">命中关键词的应用或窗口不会发送给 AI。</p>
        </div>

      <div>
        <label htmlFor="excluded-keywords" className="block text-sm font-medium text-gray-700 mb-1">
          排除应用/窗口
        </label>
        <textarea
          id="excluded-keywords"
          value={excludedText}
          onChange={e => setExcludedText(e.target.value)}
          rows={5}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
          placeholder={'Password\nToken\nBank'}
        />
        <p className="mt-1 text-xs text-gray-500">
          每行或逗号分隔一个关键词；命中的窗口不会发送给 AI。
        </p>
      </div>

      <div>
        <label htmlFor="excluded-apps" className="block text-sm font-medium text-gray-700 mb-1">
          排除应用
        </label>
        <textarea
          id="excluded-apps"
          value={draft.excludedApps.join('\n')}
          onChange={e => setDraft(d => ({
            ...d,
            excludedApps: e.target.value.split(/[\n,，]/).map(k => k.trim()).filter(Boolean),
          }))}
          rows={2}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
          placeholder={'1password\nBitwarden\nKeePassXC'}
        />
        <p className="mt-1 text-xs text-gray-500">
          命中进程名的窗口直接跳过，不截图也不分析。
        </p>
      </div>

      <div>
        <label htmlFor="excluded-titles" className="block text-sm font-medium text-gray-700 mb-1">
          排除标题关键词
        </label>
        <textarea
          id="excluded-titles"
          value={draft.excludedTitlePatterns.join('\n')}
          onChange={e => setDraft(d => ({
            ...d,
            excludedTitlePatterns: e.target.value.split(/[\n,，]/).map(k => k.trim()).filter(Boolean),
          }))}
          rows={2}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
          placeholder={'Lock Screen\nLogin'}
        />
        <p className="mt-1 text-xs text-gray-500">
          标题中包含这些关键词的窗口会跳过。
        </p>
      </div>
      </section>

      <section className="space-y-4 border-t border-gray-200 pt-5">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">界面背景</h2>
          <p className="mt-1 text-xs text-gray-500">选择舒适的背景，同时保持内容清晰可读。</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {([
            { label: '默认', value: 'plain' as const, swatch: 'bg-gray-50 border border-gray-200' },
            { label: '柔和绿', value: 'mint' as const, swatch: '' },
            { label: '天空蓝', value: 'sky' as const, swatch: '' },
            { label: '石墨灰', value: 'graphite' as const, swatch: '' },
            { label: '自定义', value: 'custom' as const, swatch: 'bg-gray-50 border border-dashed border-gray-300' },
          ]).map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setDraft(d => ({
                ...d,
                appearance: { ...d.appearance, backgroundPreset: opt.value },
              }))}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                (draft.appearance?.backgroundPreset ?? 'plain') === opt.value
                  ? 'border-green-600 bg-green-50 text-green-700'
                  : 'border-gray-300 text-gray-600 hover:border-gray-400'
              }`}
            >
              {opt.value === 'mint' && (
                <span className="w-4 h-4 rounded" style={{ background: 'linear-gradient(135deg, #d4f5e9, #e8f5e9)' }} />
              )}
              {opt.value === 'sky' && (
                <span className="w-4 h-4 rounded" style={{ background: 'linear-gradient(135deg, #dceefb, #e8f0fe)' }} />
              )}
              {opt.value === 'graphite' && (
                <span className="w-4 h-4 rounded" style={{ background: 'linear-gradient(135deg, #e8eaed, #f1f3f4)' }} />
              )}
              {opt.value === 'plain' && <span className="w-4 h-4 rounded bg-gray-50 border border-gray-200" />}
              {opt.value === 'custom' && <span className="w-4 h-4 rounded bg-gray-50 border border-dashed border-gray-300" />}
              {opt.label}
            </button>
          ))}
        </div>

        {draft.appearance?.backgroundPreset === 'custom' && (
          <div>
            <label htmlFor="custom-bg" className="block text-sm font-medium text-gray-700 mb-1">
              自定义图片
            </label>
            <input
              id="custom-bg"
              type="text"
              value={draft.appearance?.customBackground ?? ''}
              onChange={e => setDraft(d => ({
                ...d,
                appearance: { ...d.appearance, backgroundPreset: 'custom', customBackground: e.target.value },
              }))}
              placeholder="图片 URL 或 data: URI"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
            />
            <p className="mt-1 text-xs text-gray-500">
              填入本地图片路径或在线图片链接，保存在本机。
            </p>
          </div>
        )}
      </section>

      <section className="space-y-4 border-t border-gray-200 pt-5">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">数据管理</h2>
          <p className="mt-1 text-xs text-gray-500">导入、导出或清空本机活动记录。</p>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".json,.md,.markdown"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) void handleImportFile(file)
            // 重置 input，允许重复选同一个文件
            e.target.value = ''
          }}
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 text-gray-600 hover:border-gray-400 transition-colors"
          >
            导入数据
          </button>
          <button
            type="button"
            onClick={() => exportActivitiesAsJson(activities)}
            disabled={activities.length === 0}
            className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 text-gray-600 hover:border-gray-400 disabled:opacity-50 transition-colors"
          >
            导出 JSON
          </button>
          <button
            type="button"
            onClick={() => exportActivitiesAsCompactMarkdown(activities)}
            disabled={activities.length === 0}
            className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 text-gray-600 hover:border-gray-400 disabled:opacity-50 transition-colors"
          >
            导出 Markdown
          </button>
        </div>

        {importStatus && (
          <p className="text-xs text-green-700">{importStatus}</p>
        )}
        {importError && (
          <p className="text-xs text-red-600">{importError}</p>
        )}
      </section>

      <section className="space-y-4 border-t border-gray-200 pt-5">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">数据库与备份</h2>
          <p className="mt-1 text-xs text-gray-500">
            SQLite 与自动备份仅在桌面端生效；浏览器开发模式会降级到 localStorage。
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 space-y-1">
          <p>状态：{dbStatus ?? (sqliteReady ? '检测中…' : '未连接')}</p>
          <p>本地备份文件：{backupExists ? '已存在' : '尚无'}</p>
          <p>自动备份：就绪后每 30 秒写入一次</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleBackupNow()}
            disabled={backupBusy || !sqliteReady}
            className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 text-gray-600 hover:border-gray-400 disabled:opacity-50 transition-colors"
          >
            {backupBusy ? '处理中…' : '立即备份'}
          </button>
          <button
            type="button"
            onClick={() => void handleRestoreBackup()}
            disabled={backupBusy || !sqliteReady || !backupExists}
            className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 text-gray-600 hover:border-gray-400 disabled:opacity-50 transition-colors"
          >
            从备份恢复
          </button>
          <button
            type="button"
            onClick={() => void refreshDbInfo()}
            disabled={backupBusy}
            className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 text-gray-600 hover:border-gray-400 disabled:opacity-50 transition-colors"
          >
            刷新诊断
          </button>
        </div>

        {backupMsg && (
          <p className="text-xs text-gray-700">{backupMsg}</p>
        )}
      </section>

      <button
        type="button"
        onClick={handleSave}
        disabled={!draft.baseUrl.trim()}
        className="w-full py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
      >
        {saved ? '已保存' : '保存设置'}
      </button>
    </div>
  )
}
