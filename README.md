# RinkView

RinkView aims to turn fixed-camera ice hockey footage into a top-down rink view
for reviewing team positioning, spacing and coverage. The first target is
post-game coaching, not player identification or measurement-grade tracking.
The standalone prototype tracks skaters from calibrated footage and exports a
top-down position series, analytics, and a debug video. It does not run live.

## Repository layout

| Directory | Purpose |
|---|---|
| `pipeline/` | Independent Python package and tests; no API or database required |
| `shared/` | Rink templates, sample calibrations and output schemas |
| `scripts/` | Optional sample clip retrieval |
| `apps/web/`, `apps/api/` | Reserved for the coaching viewer and API |
| `worker/`, `training/`, `infra/` | Reserved for background processing, training and deployment |
| `docs/` | [MVP spec](docs/spec.md) |

## CPU quickstart

From the repo root, with Python 3.10+:

```sh
python -m venv .venv
source .venv/bin/activate
python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
python -m pip install -e './pipeline[process,test]'
python -m pytest pipeline/tests
```

On Windows PowerShell, use `py -3.10 -m venv .venv` (or your installed newer
Python) and activate it with `./.venv/Scripts/Activate.ps1`. The rest of the
commands are the same.

Process a clip using the calibration for that exact camera framing and period:

```sh
rinkview process data/p1_4k_30s.mp4 --calib shared/calibrations/ally-pally-side-p1.json --out data/outputs/p1 --device cpu --fps 5
```

`--fps` sets the detection rate (10 by default); positions are always exported
on a 10 Hz clock relative to the clip start. The first run downloads the
YOLO11s COCO weights. Use `--weights models/detector.pt` to use local Ultralytics
weights with `player`, `goalie` and `referee` classes. Keep all media, weights,
and generated outputs out of Git, including JSON.

| File | Contents |
|---|---|
| `positions.parquet`, `positions.json` | Per-track rink coordinates and velocity, with a schema-compatible JSON array for the viewer |
| `summary.json` | Team heatmaps and zone time (in on-ice player seconds), track counts, runtime and possible camera drift |
| `debug.mp4` | H.264 video at the sampled rate, with team-coloured boxes, track IDs and a top-down inset; hollow foot markers indicate an estimate |

Team A and B are per-clip jersey-colour clusters, not guaranteed consistent
across periods. The pipeline guesses their defending ends from goalie crops
and defaults to the left for A if uncertain; use `--team-a-defends left` or
`right` if the zone directions are wrong. With COCO weights, goalie and referee
roles are heuristics. Expect missed and merged boxes during occlusions,
fragmented IDs, and occasional wrong team colours or off-ice detections.
The first decoded frame is the drift reference; it does not verify that the
camera was already in the calibrated position when recording started.

To preview the P1 calibration, provide a **3840 × 2160** still from the same
camera framing. Create `data/` if it doesn't already exist:

```sh
rinkview calib-overlay --frame data/p1-frame.png --calib shared/calibrations/ally-pally-side-p1.json --out data/p1-overlay.png
```

For the sample inputs, install recent versions of [yt-dlp](https://github.com/yt-dlp/yt-dlp),
FFmpeg (including ffprobe) and Deno on PATH. Only download or use footage where
you have the necessary rights and permissions; the footage is not part of this
repository or covered by its MIT license. Keep raw clips and derived stills in
`data/` and out of Git.

```sh
python scripts/fetch_sample_clips.py
ffmpeg -ss 120 -i data/samples/LIDsyAwBd_o.webm -frames:v 1 data/p1-frame.png
```

The script requests video-only 4K excerpts from 10:00 to 13:00 and writes them to
`data/samples/`. If yt-dlp chooses a non-WebM container, use the downloaded
file's extension in the FFmpeg command. Cut times may vary around keyframes.
The script uses Deno and `--remote-components ejs:github` for YouTube's
current JavaScript challenges. If access legitimately requires your own local
browser session, pass `--cookies-from-browser firefox` (or your browser and
profile). Do not export or share cookies.

## Running on your GPU (Windows + RTX 4080 Super)

Use `--device cuda` to run YOLO on the GPU. Decode, calibration, tracking and
rendering still run on the CPU. You can run RinkView on your PC independently
of the hosted Devin session; the hosted session does not borrow your PC's GPU.

### A. WSL2

1. Update WSL (`wsl --update` in PowerShell), use a WSL2 Linux distro, and
   install the current NVIDIA driver **on Windows**. Do not install a second
   NVIDIA Linux display driver in WSL.
2. Create and activate a virtual environment inside WSL. Use the
   [PyTorch installer selector](https://pytorch.org/get-started/locally/) for
   **Linux / Pip / Python / CUDA** to install CUDA-enabled `torch` and
   `torchvision` before installing RinkView.
3. Store source videos on the WSL Linux filesystem (e.g. `~/rinkview/data`,
   not under `/mnt/c`) and run the commands in the smoke test below.

### B. Native Windows Python

Create and activate a Python virtual environment, then install an up-to-date
NVIDIA Windows driver and use the [PyTorch installer selector](https://pytorch.org/get-started/locally/)
for **Windows / Pip / Python / CUDA**. Install the CUDA wheel it recommends
for your driver and Python version, not the CPU wheel. The wheel supplies
its CUDA runtime for inference; a separate toolkit is not usually required.

### GPU smoke test (both setups)

```sh
nvidia-smi
python -c "import torch; print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'No CUDA device')"
python -m pip install -e './pipeline[process]'
rinkview process data/p1_4k_30s.mp4 --calib shared/calibrations/ally-pally-side-p1.json --out data/outputs/p1-cuda --device cuda --fps 10
```

The PyTorch check should print `True` and identify the RTX 4080 Super. Benchmark
decode separately; NVDEC and TensorRT are later optimizations, not prerequisites.
