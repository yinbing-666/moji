import { useState } from 'react'
import { useActivityStore, type DataSource } from '../stores/activityStore'

interface OnboardingDialogProps {
  onComplete: (action: 'start' | 'configure' | 'demo' | 'later') => void
}

const COMMUNICATION_EXCLUSIONS = ['WeChat', '微信', 'QQ', 'DingTalk', '钉钉', 'Feishu', '飞书']

export function OnboardingDialog({ onComplete }: OnboardingDialogProps) {
  const { settings, updateSettings, loadDemoWeek } = useActivityStore()
  const [step, setStep] = useState(0)
  const [mode, setMode] = useState<DataSource>('local')
  const [excludeCommunication, setExcludeCommunication] = useState(true)
  const [loadingDemo, setLoadingDemo] = useState(false)

  const saveChoices = () => {
    const excludedApps = excludeCommunication
      ? Array.from(new Set([...settings.excludedApps, ...COMMUNICATION_EXCLUSIONS]))
      : settings.excludedApps
    updateSettings({ dataSource: mode, excludedApps })
  }

  const finish = async (action: 'start' | 'configure' | 'demo' | 'later') => {
    saveChoices()
    if (action === 'demo') {
      setLoadingDemo(true)
      await loadDemoWeek()
    }
    onComplete(action)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/45 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="w-full max-w-xl overflow-hidden rounded-lg border border-gray-200 bg-surface shadow-elevated"
      >
        <div className="border-b border-gray-100 px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-brand-700">首次设置 · {step + 1}/3</p>
              <h2 id="onboarding-title" className="mt-1 text-xl font-semibold text-gray-900">
                {step === 0 ? '先确认采集边界' : step === 1 ? '选择分析方式' : '开始第一份复盘'}
              </h2>
            </div>
            <div className="flex gap-1" aria-hidden="true">
              {[0, 1, 2].map(index => <span key={index} className={`h-1.5 w-8 rounded-full ${index <= step ? 'bg-brand-500' : 'bg-gray-200'}`} />)}
            </div>
          </div>
        </div>

        <div className="min-h-72 px-6 py-5">
          {step === 0 && (
            <div className="space-y-5">
              <p className="text-sm leading-6 text-gray-600">墨记读取应用名、窗口标题和可选的界面文本，用于生成本地时间线。默认不截图，也不会把数据上传到墨记服务器。</p>
              <div className="divide-y divide-gray-100 border-y border-gray-200">
                {[
                  ['默认采集', '应用名、窗口标题、活动时长'],
                  ['默认不采集', '完整网址、密码框、屏幕录制和音频'],
                  ['数据位置', '活动和设置保存在本机'],
                ].map(([label, value]) => (
                  <div key={label} className="flex gap-4 py-3 text-sm">
                    <span className="w-24 shrink-0 font-medium text-gray-800">{label}</span>
                    <span className="text-gray-500">{value}</span>
                  </div>
                ))}
              </div>
              <label className="flex cursor-pointer items-start gap-3 rounded-md bg-gray-50 px-4 py-3">
                <input type="checkbox" checked={excludeCommunication} onChange={event => setExcludeCommunication(event.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
                <span>
                  <span className="block text-sm font-medium text-gray-800">默认排除聊天软件</span>
                  <span className="mt-0.5 block text-xs leading-5 text-gray-500">跳过微信、QQ、钉钉和飞书窗口，之后可在设置里逐项修改。</span>
                </span>
              </label>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              {([
                ['local', '无 LLM', '使用本地分类规则，开箱即用，窗口内容不会发送给外部模型。'],
                ['llm', '有 LLM', '由兼容 OpenAI 的模型归纳活动和报告，需要在设置中填写自己的接口。'],
              ] as Array<[DataSource, string, string]>).map(([value, label, description]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={`flex w-full items-start gap-4 rounded-md border px-4 py-4 text-left transition-colors ${mode === value ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-100' : 'border-gray-200 hover:border-gray-300'}`}
                >
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${mode === value ? 'border-brand-600' : 'border-gray-300'}`}>
                    {mode === value && <span className="h-2.5 w-2.5 rounded-full bg-brand-600" />}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-gray-900">{label}</span>
                    <span className="mt-1 block text-xs leading-5 text-gray-500">{description}</span>
                  </span>
                </button>
              ))}
              <p className="pt-2 text-xs text-gray-400">两种模式共用同一套本地数据和报告结构，之后可以随时切换。</p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="border-l-3 border-brand-400 bg-brand-50/40 px-4 py-3">
                <p className="text-sm font-medium text-gray-900">{mode === 'local' ? '本地规则已经准备好' : '下一步配置模型接口'}</p>
                <p className="mt-1 text-xs leading-5 text-gray-600">{mode === 'local' ? '开始采集后，第一条活动会立即进入时间线。' : '保存 API 地址、模型名和 Key 后即可开始采集；未配置前不会发送任何内容。'}</p>
              </div>
              <button type="button" onClick={() => void finish('demo')} disabled={loadingDemo} className="flex w-full items-center justify-between rounded-md border border-gray-200 px-4 py-3 text-left hover:border-brand-300 disabled:opacity-60">
                <span>
                  <span className="block text-sm font-medium text-gray-800">先看一周示例</span>
                  <span className="mt-0.5 block text-xs text-gray-500">追加虚构活动和上周基线，不覆盖真实记录，可随时移除。</span>
                </span>
                <span className="text-sm text-brand-700">{loadingDemo ? '载入中…' : '载入'}</span>
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50/60 px-6 py-4">
          <button type="button" onClick={() => step === 0 ? void finish('later') : setStep(step - 1)} className="px-2 py-1.5 text-sm text-gray-500 hover:text-gray-800">
            {step === 0 ? '稍后设置' : '上一步'}
          </button>
          {step < 2 ? (
            <button type="button" onClick={() => setStep(step + 1)} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">继续</button>
          ) : (
            <button type="button" onClick={() => void finish(mode === 'local' ? 'start' : 'configure')} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
              {mode === 'local' ? '开始采集' : '去配置 LLM'}
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
