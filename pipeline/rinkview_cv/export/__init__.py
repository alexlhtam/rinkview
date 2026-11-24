"""Write the per-video files consumed by the viewer and analysis tools."""

import json

import pyarrow as pa
import pyarrow.parquet as pq

POSITIONS = pa.schema([
    ("t", pa.float64()), ("frame", pa.int32()), ("track_id", pa.int32()),
    ("role", pa.string()), ("team", pa.string()), ("x_m", pa.float32()),
    ("y_m", pa.float32()), ("vx", pa.float32()), ("vy", pa.float32()), ("conf", pa.float32()),
    ("on_ice", pa.bool_()), ("interpolated", pa.bool_()),
])


def write_json(path, value):
    with path.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, allow_nan=False, separators=(",", ":"))
        handle.write("\n")


def write_positions(out, rows):
    table = pa.Table.from_pylist(rows, schema=POSITIONS)
    pq.write_table(table, out / "positions.parquet", use_dictionary=["role", "team"])
    write_json(out / "positions.json", rows)
