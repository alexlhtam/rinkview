# RinkView

RinkView aims to turn fixed-camera ice hockey footage into a top-down rink view
for reviewing team positioning, spacing and coverage. The first target is
post-game coaching, not player identification or measurement-grade tracking.
This foundation has rink geometry, file contracts and a calibration overlay.
It does **not** yet detect or track players, serve a web app, or run live.

## Repository layout

| Directory | Purpose |
|---|---|
| `pipeline/` | Independent Python package and tests; no API or database required |
| `packages/tactics-board/` | Standalone React tactics board, demo and embeddable component |
| `shared/` | Rink templates, sample calibrations and output schemas |
| `scripts/` | Optional sample clip retrieval |
| `apps/web/`, `apps/api/` | Reserved for the coaching viewer and API |
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
python -m pip install -e './pipeline[test]'
python -m pytest pipeline/tests
```

On Windows PowerShell, use `py -3.10 -m venv .venv` (or your installed newer
Python) and activate it with `./.venv/Scripts/Activate.ps1`. The rest of the
commands are the same.

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

Calibration itself runs on the CPU. These are setup options for a **future**
detector/worker, not GPU support in this foundation. You can run RinkView on
your PC independently of the hosted Devin session; the hosted session does not
automatically borrow your PC's GPU.

### A. WSL2 + Docker Desktop

1. Update WSL (`wsl --update` in PowerShell), use a WSL2 Linux distro, and
   install the current NVIDIA driver **on Windows**. Do not install a second
   NVIDIA Linux display driver in WSL. CUDA user-space libraries come from
   the container.
2. Enable the WSL2 backend in Docker Desktop and Linux containers. Verify GPU
   access, for example with an NVIDIA CUDA image:

   ```sh
   docker run --rm --gpus all nvidia/cuda:12.8.1-base-ubuntu22.04 nvidia-smi
   ```

3. In the future CUDA-enabled worker image, verify that PyTorch sees the GPU:

   ```sh
   docker run --rm --gpus all <worker-image> python -c "import torch; print(torch.cuda.is_available())"
   ```

   Replace `<worker-image>` with the image name once the worker is available.
   A CUDA smoke test should show the RTX 4080 Super and print `True` in the
   corresponding checks. Store source videos on the WSL Linux filesystem
   (e.g. `~/rinkview/data`, ext4), not under `/mnt/c`, for sequential reads
   and binding the media into Linux containers.

### B. Native Windows Python

Create and activate a Python virtual environment, then install an up-to-date
NVIDIA Windows driver and use the [PyTorch installer selector](https://pytorch.org/get-started/locally/)
for **Windows / Pip / Python / CUDA**. Install the CUDA wheel it recommends
for your driver and Python version, not the CPU wheel. The wheel supplies
its CUDA runtime for inference; a separate toolkit is not usually required.

```powershell
nvidia-smi
python -c "import torch; print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'No CUDA device')"
```

For future processing, use `--device cuda` once the processing CLI exposes
it. Benchmark decode separately; when 4K decoding limits throughput, evaluate
NVDEC with a compatible FFmpeg/PyAV build and codec. TensorRT export is a
later optimization to benchmark against the baseline, not a prerequisite.
