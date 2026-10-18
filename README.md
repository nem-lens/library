# NEM Lens event library

Price events in Australia's National Electricity Market detected by
[nem-monitor](https://github.com/nem-lens/monitor), with AEMO's own figures
for each: the public view of the NEM Lens event record (schema 2). Written
by `nem-monitor library add`; do not edit by hand.

- `index.json`: every event's headline, newest first.
- `events/<id>/headline.json`: peak and mean price, intervals at or above
  $5,000/MWh, cost to load (price x demand) and maximum demand over the
  event span.
- `events/<id>/series.json`: each region's price, demand, available
  generation and net interchange per interval.
- `events/<id>/dispatch.json`: dispatch by fuel in the event region.
- `events/<id>/interconnectors.json`: flows, AEMO's limits and the
  constraints that set them.
- `events/<id>/constraints.json`: binding generic constraints with AEMO's
  marginal values and descriptions.
- `events/<id>/unavailability.json`: units on outage or derated, with their
  rebid explanations.
- `events/<id>/notices.json`: AEMO market notices around the event.
- `events/<id>/manifest.json`: the AEMO source files and their SHA-256.

Times are interval ends in market time with the offset
(`2026-10-12T14:20:00+10:00`); compare them as times. Earlier schema 1
files (replay figures, snapshots, scenarios) remain in this repository's
history only.

Source data © AEMO, used under AEMO's copyright permissions. Not affiliated
with AEMO.
