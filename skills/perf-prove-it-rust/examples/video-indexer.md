# Video indexer: delete the passes, do not tune them

Source: the article run on this machine (Core Ultra 7 255H, 16 CPUs, 24 MiB L3, powersave governor; `scripts/machine.sh` prints the header).
Unit: `collect_visible_videos`, answering "are there enough distinct videos yet?" after every backend page.

## The floor

The ideal is a borrowed `HashSet` probe with early exit, and the full ranking pass only on the final page. The old code cloned, grouped, normalized, and sorted every hit after every page.

## Outcome

Three runs: 166.96 to 71.60 ms, 158.90 to 72.00, 155.70 to 63.55. About 2.2x to 2.45x, from deleting repeated work. Exact final video order asserted on every run.

## The rejected experiments

These matter more than the win. Caching normalized strings: 0.520 to 0.540 ms per round, rejected. Moving hits into an index-map representation: 0.681 ms, rejected. Thin LTO: larger binaries, clean builds 13.78 to 44.20 s, rejected. A perf record that only contains wins is marketing.

## Machine read

```text
cargo asm diff: clone/group/normalize/sort per page -> HashSet probe with early exit
-> the per-page passes were the work, not the ranking
-> deleting passes beat every tuning attempt
```
