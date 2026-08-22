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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="w-full max-w-xl overflow-hidden rounded-lg border border-line bg-surface shadow-elevated"
      >
        <div className="border-b border-line-soft px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-accent-ink">首次设置 · {step + 1}/3</p>
              <h2 id="onboarding-title" className="mt-1 text-xl font-semibold text-ink">
                {step === 0 ? '先确认采集边界' : step === 1 ? '选择分析方式' : '开始第一份复盘'}
              </h2>
            </div>
            <div className="flex gap-1" aria-hidden="true">
              {[0, 1, 2].map(index => <span key={index} className={`h-1.5 w-8 rounded-full ${index <= step ? 'bg-accent' : 'bg-line'}`} />)}
            </div>
          </div>
        </div>

        <div className="min-h-72 px-6 py-5">
          {step === 0 && (
            <div className="space-y-5">
              <p className="text-sm leading-6 text-ink-muted">墨记读取应用名、窗口标题和可选的界面文本，用于生成本地时间线。默认不截图，也不会把数据上传到墨记服务器。</p>
              <div className="divide-y divide-line-soft border-y border-line">
                {[
                  ['默认采集', '应用名、窗口标题、活动时长'],
                  ['默认不采集', '完整网址、密码框、屏幕录制和音频'],
                  ['数据位置', '活动和设置保存在本机'],
                ].map(([label, value]) => (
                  <div key={label} className="flex gap-4 py-3 text-sm">
                    <span className="w-24 shrink-0 font-medium text-ink">{label}</span>
                    <span className="text-ink-muted">{value}</span>
                  </div>
                ))}
              </div>
              <label className="flex cursor-pointer items-start gap-3 rounded-md bg-sunken px-4 py-3">
                <input type="checkbox" checked={excludeCommunication} onChange={event => setExcludeCommunication(event.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
                <span>
                  <span className="block text-sm font-medium text-ink">默认排除聊天软件</span>
                  <span className="mt-0.5 block text-xs leading-5 text-ink-muted">跳过微信、QQ、钉钉和飞书窗口，之后可在设置里逐项修改。</span>
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
                  className={`flex w-full items-start gap-4 rounded-md border px-4 py-4 text-left transition-colors ${mode === value ? 'border-accent bg-accent-soft ring-1 ring-accent-soft' : 'border-line hover:border-line-strong'}`}
                >
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${mode === value ? 'border-accent' : 'border-line-strong'}`}>
                    {mode === value && <span className="h-2.5 w-2.5 rounded-full bg-accent" />}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-ink">{label}</span>
                    <span className="mt-1 block text-xs leading-5 text-ink-muted">{description}</span>
                  </span>
                </button>
              ))}
              <p className="pt-2 text-xs text-ink-faint">两种模式共用同一套本地数据和报告结构，之后可以随时切换。</p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="border-l-3 border-accent bg-accent-soft px-4 py-3">
                <p className="text-sm font-medium text-ink">{mode === 'local' ? '本地规则已经准备好' : '下一步配置模型接口'}</p>
                <p className="mt-1 text-xs leading-5 text-ink-muted">{mode === 'local' ? '开始采集后，第一条活动会立即进入时间线。' : '保存 API 地址、模型名和 Key 后即可开始采集；未配置前不会发送任何内容。'}</p>
              </div>
              <button type="button" onClick={() => void finish('demo')} disabled={loadingDemo} className="flex w-full items-center justify-between rounded-md border border-line px-4 py-3 text-left hover:border-accent disabled:opacity-60">
                <span>
                  <span className="block text-sm font-medium text-ink">先看一周示例</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">追加虚构活动和上周基线，不覆盖真实记录，可随时移除。</span>
                </span>
                <span className="text-sm text-accent-ink">{loadingDemo ? '载入中…' : '载入'}</span>
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line-soft bg-sunken px-6 py-4">
          <button type="button" onClick={() => step === 0 ? void finish('later') : setStep(step - 1)} className="px-2 py-1.5 text-sm text-ink-muted hover:text-ink">
            {step === 0 ? '稍后设置' : '上一步'}
          </button>
          {step < 2 ? (
            <button type="button" onClick={() => setStep(step + 1)} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover">继续</button>
          ) : (
            <button type="button" onClick={() => void finish(mode === 'local' ? 'start' : 'configure')} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover">
              {mode === 'local' ? '开始采集' : '去配置 LLM'}
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
