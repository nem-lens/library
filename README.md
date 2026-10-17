# NEM Lens event library

Headline results and replay inputs for NEM price events detected by
[nem-monitor](https://github.com/nem-lens/monitor), replayed with
[nemcf](https://github.com/nem-lens/engine). Written by
`nem-monitor library add`; do not edit by hand.

- `index.json`: every event's headline, newest first.
- `events/<id>/headline.json`: peak price, duration, baseline replay mean
  price and each scenario's change in mean price, over the event span.
- `events/<id>/snapshots.json.gz`: the engine's intervals for the event span,
  for running scenarios in the browser.
- `events/<id>/scenarios/`: the scenarios run.
- `events/<id>/manifest.json`: the AEMO source files and their SHA-256.

Times are interval ends in market time with the offset
(`2026-10-12T14:20:00+10:00`); compare them as times, not as strings with
the offset stripped from one side.

Source data © AEMO, used under AEMO's copyright permissions. Not affiliated
with AEMO.
