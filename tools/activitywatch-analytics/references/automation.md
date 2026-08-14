# Scheduled report workflow

Create a scheduled task only after a manual report succeeds and the user explicitly requests it.

Use the local project rather than an isolated worktree so the task can reuse `activitywatch-reports/profile.json` and prior reports. Keep the ActivityWatch application and the desktop agent running when local data is required.

Daily prompt template:

```text
Use $analyze-activitywatch to generate today's ActivityWatch report in this project. Reuse the existing profile, write all artifacts under activitywatch-reports, and report only material changes or actionable findings.
```

Weekly prompt template:

```text
Use $analyze-activitywatch to analyze the previous complete week. Reuse the existing profile, compare with the prior four complete weeks, generate all offline report artifacts, and summarize the three highest-impact findings.
```

Ask the user for local execution time and timezone if they were not supplied. Do not create or change a schedule implicitly.
