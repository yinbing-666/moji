import { useState } from 'react'
import { useActivityStore } from '../stores/activityStore'

const INTERVAL_OPTIONS = [
  { label: '1 分钟', value: 60 },
  { label: '2 分钟', value: 120 },
  { label: '5 分钟', value: 300 },
  { label: '10 分钟', value: 600 },
]

export function Settings() {
  const { settings, updateSettings } = useActivityStore()
  const [showKey, setShowKey] = useState(false)
  const [draft, setDraft] = useState(settings)
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    updateSettings(draft)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">通义千问 API Key</label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={draft.apiKey}
            onChange={e => setDraft(d => ({ ...d, apiKey: e.target.value }))}
            placeholder="sk-..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
          />
          <button
            type="button"
            onClick={() => setShowKey(v => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
          >
            {showKey ? '隐藏' : '显示'}
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-400">从 <a href="https://dashscope.console.aliyun.com/" target="_blank" className="underline">阿里云 DashScope</a> 获取</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">截图间隔</label>
        <div className="flex gap-2">
          {INTERVAL_OPTIONS.map(opt => (
            <button
              key={opt.value}
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

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-700">启动时自动开始截图</p>
          <p className="text-xs text-gray-400">打开应用后自动开始定期截屏</p>
        </div>
        <button
          onClick={() => setDraft(d => ({ ...d, autoStart: !d.autoStart }))}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            draft.autoStart ? 'bg-green-600' : 'bg-gray-300'
          }`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            draft.autoStart ? 'translate-x-6' : 'translate-x-1'
          }`} />
        </button>
      </div>

      <button
        onClick={handleSave}
        className="w-full py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium transition-colors"
      >
        {saved ? '✓ 已保存' : '保存设置'}
      </button>
    </div>
  )
}
