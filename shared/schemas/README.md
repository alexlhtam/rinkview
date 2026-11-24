# Vision output contracts

Both outputs are scoped to a single source video. Positions are stored as Parquet
with the column types in [the spec](../../docs/spec.md#63-output-schema).
The positions JSON export is a bare array with the same column names; `none` is
a literal team value, not null. Sample times are seconds from the video start,
not game-clock times; track IDs can repeat in other videos. Coordinates are in
metres from centre ice, +x toward the right goal and +y toward the far boards.

Summary zones are relative to each team's defending end for the specified
period. Zone totals and heatmap cell values are cumulative on-ice player
seconds (not wall-clock seconds); heatmaps have rectangular rows in increasing
y and columns in increasing x, with the origin at the lower edge of cell [0,0].
Counts are distinct track IDs per team observed in that period. Drift ranges
are in source-video seconds with end ≥ start. These semantic constraints are
in addition to JSON Schema validation. See the two `*.example.json` files.
