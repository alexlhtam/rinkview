# RinkView

RinkView aims to turn fixed-camera ice hockey footage into a top-down rink view
for reviewing team positioning, spacing and coverage. The first target is
post-game coaching, not player identification or measurement-grade tracking.
The prototype includes a calibration overlay, a pipeline that tracks skaters
and exports positions and analytics, a local Game Viewer, and a separate
coaching tactics board. It does not run live.

## Repository layout

| Directory | Purpose |
|---|---|
| `pipeline/` | Independent Python package and tests; no API or database required |
| `packages/tactics-board/` | Standalone React tactics board, demo and embeddable component |
| `shared/` | Rink templates, sample calibrations and output schemas |
| `scripts/` | Optional sample clip retrieval |
| `apps/web/` | Local Game Viewer |
| `apps/api/` | Reserved for the API |
| `worker/`, `training/`, `infra/` | Reserved for background processing, training and deployment |
| `docs/` | [MVP spec](docs/spec.md) |

## Coaching tactics board

Run the standalone demo with Node.js 22.12+ (or Node.js 24 LTS) and npm:

```sh
cd packages/tactics-board
npm ci
npm run dev
```

Start with a blank rink or choose **Load example**. Use **Add player** to place
skaters by hand, and use the tools on the left to draw routes, mark coverage and
measure spacing. Choose **Ghost correction** and drag a player from their
original position. Scrub to another time and drag the ghost again to add a
keyframe; use **Play animation** to see the interpolation. **Present** opens a
full-screen board. **Save JSON** and **Load JSON** use the
[Teaching Clip schema](shared/schemas/teaching-clip.schema.json); **Export PNG**
saves the board at the current playhead with the current layer settings.

`npm test` runs the Vitest suite; `npm run typecheck` checks the TypeScript; and
`npm run build` builds the Vite demo and the library.

To embed the built package, import `TacticsBoard` from `@rinkview/tactics-board`
and its stylesheet from `@rinkview/tactics-board/style.css`. Pass a shared rink
template as `rinkTemplate`, an optional frozen array of position samples as
`initialPlayers` (one sample per track), and optionally a saved `initialClip`.
`onChange(clip)` receives committed edits, imports, and undo/redo, not playback
or layer changes. Remount with a new React key to initialize a different clip.
Times are seconds on the source video's timeline (or from zero on a blank
board). Moving a tracked player creates a correction without changing the
source. When reopening a clip backed by video, supply the same frozen frame and
rink template to show its original tracked players.

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

## Run the Game Viewer

Use Node.js 22.12+ and a current browser. From the repo root:

```sh
npm --prefix apps/web ci
npm --prefix apps/web run generate:demo
npm --prefix apps/web run dev
```

Open the URL printed by Vite. Choose the 30-second P1 sample clip or another
local video, `data/web-demo/positions.json`, `data/web-demo/summary.json` and
`shared/rink_templates/ally-pally-estimate.json`, then select **Open game**.
The default template matches the P1 calibration. The generated 14 tracks are
**synthetic**, not detections from the video: they share the video clock but
do not correspond to specific players on screen. The clip is not included in
the repository. No files are uploaded or sent to a backend.

To review real tracks, open the same source clip you processed and load the
pipeline's `positions.json` and `summary.json` instead of the demo files.
Use the rink template referenced by that clip's calibration.

The original 4K clip works in browsers that can decode it smoothly. If needed,
make a 1080p H.264 copy (preserving the start time and using the synthetic
data's default 60 fps for frame stepping):

```sh
ffmpeg -i p1_4k_30s.mp4 -map 0:v:0 -vf "scale=1920:-2,fps=60" -c:v libx264 -pix_fmt yuv420p -t 30 data/p1_1080p_30s.mp4
```

Use the shared timeline to scrub, play at 0.25–2×, or step through the
video. Frame stepping estimates the source rate from the positions export
(30 fps fallback); variable-frame-rate video may not step exactly one frame.
Select a rink dot or use the track editor to reassign its team for the whole
track. Team corrections affect the rink, not the imported analytics.
Use **I**/**O** outside form fields to mark a review range, then open
**Review clips** to name it or export saved ranges as JSON. Changes and clips
are available until you replace the game or reload the page.

See [apps/web](apps/web/README.md) for the prototype scope and checks.

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

### C. Docker Desktop with WSL2 (optional)

Enable the WSL2 backend and use Linux containers. With the NVIDIA Windows
driver installed, verify passthrough with a CUDA container:

```sh
docker run --rm --gpus all nvidia/cuda:12.8.1-base-ubuntu22.04 nvidia-smi
```

RinkView does not ship a worker image yet. If using your own PyTorch CUDA
image, pass `--gpus all`, bind videos from the WSL Linux filesystem, and
run the PyTorch smoke test inside the container.

### GPU smoke test

```sh
nvidia-smi
python -c "import torch; print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'No CUDA device')"
python -m pip install -e './pipeline[process]'
rinkview process data/p1_4k_30s.mp4 --calib shared/calibrations/ally-pally-side-p1.json --out data/outputs/p1-cuda --device cuda --fps 10
```

The PyTorch check should print `True` and identify the RTX 4080 Super. Benchmark
decode separately; NVDEC and TensorRT are later optimizations, not prerequisites.
