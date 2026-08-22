import { useMemo, useState } from 'react'
import { useActivityStore, type Activity } from '../stores/activityStore'
import { buildLocalEfficiencyReport, type EfficiencyPeriod } from '../utils/awReport'
import { AwReportDashboard } from './AwReportDashboard'

const PERIOD_OPTIONS = [
  { value: 'today', label: '今天' },
  { value: 'this-week', label: '本周' },
  { value: 'last-week', label: '上周' },
]

interface AwAnalyticsProps {
  activities: Activity[]
}

/** ActivityWatch 由 APP 在后台维护，效率页始终读取同一份墨记活动数据。 */
export function AwAnalytics({ activities }: AwAnalyticsProps) {
  const { settings } = useActivityStore()
  const [period, setPeriod] = useState<EfficiencyPeriod>('today')
  const localReport = useMemo(
    () => buildLocalEfficiencyReport(activities, period, new Date(), settings.classificationRules),
    [activities, period, settings.classificationRules],
  )

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-h3 font-semibold text-ink">效率分析</h2>
          <p className="mt-0.5 text-xs text-ink-muted">由墨记自动采集并在本机完成分析，ActivityWatch 服务随应用启动。</p>
        </div>
      </div>


      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-line bg-surface p-0.5 text-sm" role="group" aria-label="效率分析周期">
          {PERIOD_OPTIONS.map(opt => <button key={opt.value} type="button" onClick={() => setPeriod(opt.value as EfficiencyPeriod)} className={`rounded px-3 py-1.5 ${period === opt.value ? 'bg-inverse text-on-inverse' : 'text-ink-muted'}`}>{opt.label}</button>)}
        </div>
      </div>

      {localReport ? <AwReportDashboard report={localReport} /> : <p className="rounded-lg border border-line bg-surface p-6 text-center text-sm text-ink-muted">暂无效率数据。先开始采集，报告会在这里自动形成。</p>}
    </section>
  )
}
