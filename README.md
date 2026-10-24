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
  generation and net interchange per interval, and its contingency reserve
  ratio (below).
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

## Contingency reserve ratio

The contingency reserve ratio (CRR) is inspired by WattClarity's
Instantaneous Reserve Plant Margin (IRPM), which Global-Roam has shown in
NEMwatch since the early years of the NEM: surplus available generation
across the NEM divided by aggregate demand, a real-time, non-price
indicator of how tight supply is ([WattClarity on the
IRPM](https://wattclarity.com.au/?p=22205)). The CRR keeps the IRPM's idea
of reading tightness from available plant in each dispatch interval, but
asks a narrower question: could the region replace the loss of its largest
single element?

| | IRPM (WattClarity) | CRR (here) |
| --- | --- | --- |
| Area | The whole NEM, or an economic island | One region, with room to raise imports up to AEMO's interconnector limits |
| Spare | Available generation less demand | Every other unit's headroom (availability less dispatch), plus import room, less the tripped element's own headroom |
| Scaled by | Demand | The largest single contingency: the biggest unit's dispatched output (DUID), or a DC link's flow into the region |
| Reading | A percentage; under about 15% NEM-wide, volatility is likely | A ratio; below 1, the region could not have replaced that loss |

Why it differs:

- **Scaled by the largest contingency, not demand.** Security and reserve
  are judged against credible contingencies, in the spirit of AEMO's LOR2
  (reserve below the largest credible contingency). The same percentage of
  demand means a different thing in South Australia and in New South Wales.
- **Per region, with AEMO's import limits.** Library events are regional.
  AEMO's limits already include the network constraints on imports, which
  covers some of what economic islands do for the IRPM.
- **Units as DUIDs, at their dispatched output.** The ratio moves with
  dispatch. A DUID can aggregate machines, and transmission protection
  often trips a whole station.
- **DC links count, AC links do not.** Losing Basslink, Murraylink or
  Directlink is a single loss to the importing region. AC links are
  network contingencies, left out like other network outages.
- **Availability, not deliverability.** As in the IRPM, ramp rates and
  whether slow-start plant is online are not considered.

Limits: plant and DC links only, so an event driven by a network
constraint can show a high CRR at the price cap. Import room assumes the
neighbouring regions have plant to send. It is about energy cover after a
trip, not frequency control. It is arithmetic on AEMO's DISPATCH
UNIT_SOLUTION and INTERCONNECTORRES (pricing run).

Source data © AEMO, used under AEMO's copyright permissions. Not affiliated
with AEMO.
