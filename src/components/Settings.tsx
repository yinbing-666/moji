import { useEffect, useState } from 'react'
import { useActivityStore } from '../stores/activityStore'

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
  const { settings, updateSettings } = useActivityStore()
  const [showKey, setShowKey] = useState(false)
  const [draft, setDraft] = useState(settings)
  const [excludedText, setExcludedText] = useState(settings.excludedKeywords.join('\n'))
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setDraft(settings)
    setExcludedText(settings.excludedKeywords.join('\n'))
  }, [settings])

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
      saveScreenshotThumbnails: draft.saveScreenshotThumbnails,
    })
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2000)
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
