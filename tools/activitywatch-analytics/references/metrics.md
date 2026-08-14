# Metrics contract

## Productivity levels

Map each exclusive ActivityWatch category path to one of these levels:

| Level | Points | Meaning |
| --- | ---: | --- |
| `focus` | 100 | Deep, goal-advancing work |
| `other_work` | 75 | Useful support work and routine collaboration |
| `neutral` | 50 | Neither clearly productive nor distracting |
| `personal` | 25 | Legitimate personal or leisure activity |
| `distracting` | 0 | Activity the user explicitly wants to reduce |

Compute the normalized pulse as the active-time-weighted mean of these points. Treat unmapped and uncategorized activity as neutral, but report mapping and category coverage separately.

Compute productive share as `(focus_seconds + other_work_seconds) / active_seconds`.

Keep ActivityWatch native score separate. Inherit a category's native score from its nearest scored parent, then compute `sum(hours * native_score)`.

## Exclusive and overlapping dimensions

The category distribution is exclusive: every active second belongs to one deepest category path or `Uncategorized`.

The following are overlapping derived dimensions and must not be mixed into the exclusive donut:

- deep-work blocks;
- AI-assisted time;
- productivity level;
- work-hours membership.

## Baselines

- Daily: compare with up to four same-weekday observations from the previous 28 days; require at least three.
- Weekly: compare with the previous four complete weeks; require at least three.
- Prefer an explicit profile goal over a historical baseline.
- Suppress anomaly language when the baseline is insufficient.

Use a default actionable threshold of both 30 minutes and 25 percent versus baseline. Keep the values configurable in `profile.json`.

## Deep work

Treat `focus` events as deep-work candidates. Merge adjacent candidates when the gap is at most two minutes. Count a block as deep work when it lasts at least 25 minutes. Report total deep-work time, longest block, block count, and the hours where blocks started.

## Recommendations

Return at most three primary recommendations. Each must include:

1. a metric-backed observation;
2. an interpretation with uncertainty;
3. one small action the user can perform;
4. a metric to inspect on the next report.

Prioritize user goals, large distracting deviations, low category coverage, low mapping confirmation, and reduced focus time in that order.
