# Data and privacy contract

## Source order

1. Use the ActivityWatch REST and Query APIs at `http://127.0.0.1:5600` or a configured local address.
2. Use a user-provided ActivityWatch JSON export when the service is unavailable.
3. Read settings from the API, an explicit `--settings` file, or the platform settings directory.
4. Do not open the live SQLite database.

Platform roots:

- macOS: `~/Library/Application Support/activitywatch`
- Windows: `%LOCALAPPDATA%\activitywatch`

Official references:

- [REST API](https://docs.activitywatch.net/en/latest/api/rest.html)
- [Working with ActivityWatch data](https://docs.activitywatch.net/en/latest/examples/working-with-data.html)
- [Platform directories](https://docs.activitywatch.net/en/latest/directories.html)
- [Exporting data](https://docs.activitywatch.net/en/latest/features/exporting-data.html)

Support both `aw-server` and `aw-server-rust`, legacy `classes`, and `category_sets` plus `active_set_ids`.

## Safe output fields

Safe by default:

- category paths and totals;
- application names and totals;
- domain-only website totals;
- active and AFK totals;
- hourly aggregates and coarse blocks;
- rule IDs, patterns, match totals, and conflicts;
- metric-derived recommendations.

Forbidden in stdout, facts, report artifacts, and model context:

- raw window titles;
- full URLs, queries, and fragments;
- filenames and document names;
- chat and email subjects;
- raw event arrays.

The collector may hold forbidden fields in memory only long enough to classify and aggregate them.

## Rule auditing

Compile and test rules locally without changing ActivityWatch. Report invalid, empty, duplicate, overlapping, and unused rules. For uncategorized activity, propose rules only from escaped application names or domains; never reproduce title fragments.

## Failure behavior

- Explain how to start ActivityWatch or provide an export when the API is unavailable.
- Mark missing AFK or browser buckets explicitly.
- Continue with application-only analysis when browser data is unavailable.
- Never silently substitute fabricated data.
