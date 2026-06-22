import { useEffect, useState } from 'react'
import { useActivityStore } from '../stores/activityStore'

const INTERVAL_OPTIONS = [
  { label: '1 min', value: 60 },
  { label: '2 min', value: 120 },
  { label: '5 min', value: 300 },
  { label: '10 min', value: 600 },
]

export function Settings() {
  const { settings, updateSettings } = useActivityStore()
  const [showKey, setShowKey] = useState(false)
  const [draft, setDraft] = useState(settings)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setDraft(settings)
  }, [settings])

  const handleSave = () => {
    updateSettings({
      apiKey: draft.apiKey.trim(),
      baseUrl: draft.baseUrl.trim().replace(/\/+$/, ''),
      intervalSeconds: draft.intervalSeconds,
      autoStart: draft.autoStart,
    })
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="max-w-lg space-y-6">
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
          Stored locally in this app. Do not commit real keys to the repo.
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
          Must expose an OpenAI-compatible /chat/completions endpoint.
        </p>
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

      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-700">启动时自动开始截图</p>
          <p className="text-xs text-gray-500">Start periodic capture when the app opens.</p>
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

      <button
        type="button"
        onClick={handleSave}
        disabled={!draft.baseUrl.trim()}
        className="w-full py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
      >
        {saved ? '✓ 已保存' : '保存设置'}
      </button>
    </div>
  )
}
