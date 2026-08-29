# 时段热力图（P0-1）实现方案

## 1. 数据聚合：Rust 侧 SQLite

**不新增表、不新增列。** 复用 `activities` 表现有字段（`start_ts` / `end_ts` 或 `start_ts + duration_sec`、`category`、`app`），在 `query.rs` 增加一个查询函数，`db.rs` 按现有 `#[tauri::command]` 模式暴露 `db_hourly_heatmap(days: u32) -> Vec<HeatCell>`。

分组思路：按**本地时区**的「日期 + 小时」两级分组，SQLite 用 `datetime(start_ts,'unixepoch','localtime')` 派生：

```sql
SELECT date(datetime(start_ts,'unixepoch','localtime'))        AS day,
       CAST(strftime('%H', datetime(start_ts,'unixepoch','localtime')) AS INTEGER) AS hour,
       SUM(duration_sec) / 60.0                                AS minutes,
       COUNT(*)                                                AS samples,
       category
FROM activities
WHERE start_ts >= ?1               -- now - days*86400，对齐到当天 00:00
GROUP BY day, hour, category
ORDER BY day, hour;
```

按 `(day, hour, category)` 分组而非只到 hour，是为了让前端同时拿到「总分钟数」和「该格主导分类」，一次查询满足着色与 tooltip 两个需求，168 格 × 5 分类上限 840 行，可忽略成本。

**跨小时归属**：采集是定时窗口快照，单条活动时长通常远小于 1 小时，v1 直接按 `start_ts` 所在小时归属，误差 < 1 格。若后续发现长活动占比高，再在同一 SQL 外层套递归 CTE 把区间切成小时片段，接口形态不变。

**前端数据形态**（`src/utils/db.ts` 新增 `dbHourlyHeatmap`）：

```ts
type HeatCell = { day: string; hour: number; minutes: number; samples: number; category: string };
type HeatmapData = HeatCell[];   // 稀疏，缺失格即无数据
```

前端负责补齐 `days × 24` 的稀疏矩阵与分类合并，Rust 只回原始分组行。

## 2. React 组件结构

```
<HourlyHeatmap days={7} />              // 容器：取数、状态、空态
  └─ <HeatmapGrid cells matrix max />   // CSS grid，24 列 × N 行 + 轴标签
       └─ <HeatCell minutes hue title/> // React.memo
```

**props / 状态**

- `HourlyHeatmap`：`{ days?: 3|5|7; onSelectHour?: (day, hour) => void }`；内部 `useState` 持有 `rows: HeatCell[] | null`、`loading`、`error`，`useEffect` 调 `dbHourlyHeatmap(days)`。
- `HeatmapGrid`：纯展示，接 `matrix: CellAgg[][]`（已归一化）与 `max`。

**着色算法**：采用「分类色定色相 + 强度定不透明度」，与现有 24 小时时间轴视觉语言一致。

1. 每格聚合出 `total = Σminutes` 与 `dominant = argmax(category)`；
2. 色相取分类色（开发靛蓝 / 会议橙 / 文档青 / 沟通玫红 / 其他灰）；
3. 强度 `t = sqrt(min(total, p95) / p95)`，`p95` 取全矩阵非零格的 95 分位，避免单个满格拉平其余；平方根而非对数——单格上限仅 60 分钟，动态范围小，对数会过度压缩；
4. 输出 `backgroundColor: color-mix(in oklch, var(--cat-color) ${20 + t*80}%, transparent)`，Tailwind 4 原生支持，无新依赖。

**空 / 稀疏数据**：整段无数据 → 渲染灰底网格 + 居中文案「还没有足够的活动记录，先让墨记跑一会儿」；单格无数据 → `bg-neutral-100 dark:bg-neutral-800/40` 空格，不渲染 tooltip；某天无数据但其他天有 → 该行正常保留为空格，保证日期轴连续。

**性能**：`useMemo` 缓存矩阵构建与 p95 计算（依赖 `rows`）；`HeatCell` 用 `React.memo` + 稳定的 props（颜色字符串、title 文本在 memo 内算）；168 个 div，首次渲染 <16ms，无需虚拟化；tooltip 用原生 `title` + 一个受控的轻量浮层，hover 状态提到 Grid 层用单个 `hoveredKey`，避免每格各持状态。

## 3. 与 TodayOverview / AwReportDashboard 的分工

- **TodayOverview**：叙事层，回答「今天怎么样」，保持前端 `useMemo` 过滤 `activities`，不动。
- **HourlyHeatmap**：节律层，回答「我这几天什么时候在干活」，走 SQLite 聚合而非前端过滤——跨 7 天的数据不该全量拉进内存，这是与 TodayOverview 的核心分工线。
- **AwReportDashboard**：评价层（专注/分心分级、隐私配置），与热力图正交，不合并。

**复用**：不抽通用 hook（两者数据源不同，强行统一会把 SQLite 聚合退化成前端过滤）。只抽两个纯函数到 `src/utils/`：`getCategoryColor(category)` 与 `formatDuration(minutes)`，供时间轴、TodayOverview、热力图共用，消除现有重复。

**位置**：仪表盘首屏，「今日投入」英雄卡之下、24 小时活动时间轴之上。时间轴是「今天的一条线」，热力图是「近 7 天的一张面」，先面后线符合从概览到细节的阅读顺序；两者共用同一套分类色，用户能直接把某格的靛蓝对应到时间轴的靛蓝段。点击热力格可选地滚动/高亮时间轴对应小时（`onSelectHour`，v1 可留空实现）。

## 4. 验收标准

**功能**

1. 仪表盘首屏可见完整 `7 × 24` 网格，含星期/日期行标签与 0、6、12、18、23 列标签。
2. hover 任意有数据格，200ms 内显示：`08-29 周五 14:00–15:00 · 42 分钟 · 主要：开发`。
3. hover 空格显示「无记录」或不显示浮层，不报错。
4. 全空数据显示占位文案，不出现空白区域或红屏。
5. 切换 3/5/7 天（若开放）后网格行数正确，无残留旧行。

**正确性**

6. 任取 2 天，热力图该天总分钟数 = 对同一天执行 `SELECT SUM(duration_sec)/60 FROM activities WHERE date(...)=?` 的结果，误差 ≤ 1 分钟。
7. 任取 1 格，其主导分类与 SQL 中该 `(day,hour)` 分组下 `SUM` 最大的 category 一致。
8. 单格 `minutes` 恒 ≤ 60（超出即暴露跨小时归属问题）。
9. 跨 00:00 与跨夏令时/时区切换后日期归属仍正确（本地时区口径）。

**性能**

10. 7 天数据下，`dbHourlyHeatmap` 单次调用 P95 < 50ms（Rust 侧计时日志）。
11. 组件从挂载到网格可见 < 200ms；React DevTools Profiler 中 hover 单格时重渲染组件数 ≤ 2。
12. 数据量 30 天 / 10 万条活动记录下查询仍 < 200ms。

**无回归**

13. TodayOverview、24 小时时间轴、分类占比堆叠条、周复盘、报告历史的现有行为与数值不变。
14. 未新增 npm / cargo 依赖（`package.json`、`Cargo.toml` diff 为空）。
15. 未新增数据表或列（migration diff 为空）；`dbGetStorageStats` 输出不变。
16. 亮/暗色主题下色阶均可辨（最低强度格与空格可区分）。