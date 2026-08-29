## 1. 叙事卡信息结构

| 字段 | 定义 | 算法 |
|---|---|---|
| activeRange | 最早 start → 最晚 end | 区间并集求总时长 |
| longestFocus | 最长专注段 | 同 app 且间隔≤5min 合并，取时长最大者 |
| mainThread | 今日主线一句话 | 按 category 聚合占比最高者 + 该类内最长 app |

**durationSeconds 归一化**：AW 重叠事件按区间求并集；UIA 用相邻同 app timestamp 差值重建区间，上限 5min；缺失回退到下条间隔。

## 2. 两种生成方式

**a. 本地模板（默认）** — 按优先级命中：

- P1 主线占比≥50% 且有最长专注：「{时段}主要在{分类}，{app} 连续 {n} 分钟。」
- P2 分散切换：「今天在 {n} 个应用间切换，节奏较碎。」
- P3 仅活跃区间：「从 {start} 到 {end}，共 {n} 分钟。」
- P4 空数据：「今天还没有记录。」

{时段}由开始小时映射；分类中文复用现有 `CATEGORY_LABEL`；任一步出错兜底 P4。

**b. 有 LLM** — 只发聚合摘要 `{ totalMinutes, activeRange, topApps[3], categoryRatio, longestFocus }`，不发原始明细。prompt 要求一句 ≤40 字中文陈述，不臆测不评价。超时 3s / 报错 / 空 / 超长一律降级保留模板文案；AbortController 取消，同日缓存。

## 3. 组件改动点

新增：`NarrativeCard.tsx`（纯渲染）、`useNarrativeCard.ts`（hook）、`narrative/segments.ts` 与 `templates.ts`（纯函数）。

props：`{ activities, enableLLM?: boolean = false, className? }`
hook：`useMemo` 算数据与模板文案，`useEffect` 发 LLM 请求。

`TodayOverview.tsx` 只加一行，位置在三张统计卡之前：

```tsx
<NarrativeCard activities={activities} enableLLM={llmEnabled} />
```

开关键 `narrative.llmEnabled` 默认 false，关闭时行为与现状完全一致。

## 4. 验收标准

| 维度 | 标准 |
|---|---|
| 功能 | 模板四级可复现；AW/UIA 两源 totalMinutes 差异≤10%；longestFocus 与时间轴峰值一致；LLM 失败无弹窗 |
| 性能 | 1000 条 <50ms；useMemo 命中缓存；LLM 3s 超时降级；卸载无挂起请求 |
| 可访问性 | section 带 aria-label；aria-live="polite"；真实文本非图片；对比度≥4.5:1 |
| 空数据 | 空数组 / 全缺 durationSeconds / 全 <2min 均命中 P4，无 NaN |