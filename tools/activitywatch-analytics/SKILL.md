---
name: analyze-activitywatch
description: Analyze local ActivityWatch time-tracking data and generate privacy-preserving offline HTML, Markdown, JSON, and SVG reports. Use when a user asks to inspect ActivityWatch activity, productivity, focus time, applications, websites, category rules, daily or weekly trends, efficiency scores, or recurring ActivityWatch reports on macOS or Windows.
---

# Analyze ActivityWatch

Generate a local-first report from ActivityWatch without exposing raw window titles, full URLs, document names, or message subjects.

## Workflow

1. Resolve this skill directory and use `scripts/activitywatch_analytics.py`; do not recreate its calculations in the conversation.
2. Ask for a period only when the user did not imply one. Default to `today` for a general request and `last-week` for a weekly review.
3. Run `analyze` with the requested period, language, and output directory:

   ```bash
   python3 <skill-dir>/scripts/activitywatch_analytics.py analyze \
     --period today \
     --locale zh-CN \
     --output ./activitywatch-reports
   ```

4. Let source mode default to `auto`. It must prefer ActivityWatch's read-only localhost API. When the server is unavailable, use `--export <export.json>` and optionally `--settings <settings.json>`.
5. Read the generated `report.json`, not raw ActivityWatch events, before writing any additional narrative. Preserve its metric values and uncertainty labels.
6. Return links to `report.html`, `report.md`, and `report.json`. Explain that the HTML is self-contained and needs no server after generation.
7. Create a scheduled task only after a manual report succeeds and the user explicitly requests a cadence. Read `references/automation.md` first.

## Non-negotiable boundaries

- Keep all source access read-only. Never write ActivityWatch settings, buckets, events, or databases.
- Never print or persist raw window titles, full URLs, filenames, document names, or chat/email subjects.
- Never read the live SQLite database. Prefer the API; use an exported JSON file offline.
- Treat the user's ActivityWatch category tree as the time-allocation source of truth.
- Keep the normalized 0–100 productivity pulse separate from ActivityWatch's native hour-weighted score.
- Label inferred productivity mappings as `provisional`; call the score calibrated only when mappings are confirmed.
- Do not claim population percentiles. Compare only with the user's own history.
- Do not judge AI, communication, media, or games from their names alone. Use the profile, goals, and personal baseline.
- Do not place overlapping dimensions such as deep work or AI use into the exclusive category donut.

## Inputs and outputs

The script supports:

- `analyze`: collect, score, audit rules, generate deterministic insights, and render all artifacts.
- `collect`: create a privacy-safe facts file for advanced agent enrichment.
- `render`: rebuild HTML, Markdown, JSON, and SVG from an existing report JSON.
- `demo`: generate a synthetic report without accessing ActivityWatch.

Use `--help` for the exact CLI. Default output is `activitywatch-reports/<period-id>/` with a persistent `activitywatch-reports/profile.json`.

Read `references/metrics.md` before changing scores or advice thresholds. Read `references/data-and-privacy.md` before changing acquisition, schemas, or privacy behavior.

## Quality checks

- Verify category seconds sum to active seconds within rounding tolerance.
- Verify all percentages use the same denominator shown in the report.
- Verify `report.html` contains no external scripts, stylesheets, fonts, or image URLs.
- Verify sensitive source strings do not appear in generated artifacts.
- Prefer concrete suggestions in the form: evidence, interpretation, action, verification metric.
