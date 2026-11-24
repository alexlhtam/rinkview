# RinkView

RinkView aims to turn fixed-camera ice hockey footage into a top-down rink view
for reviewing team positioning, spacing and coverage. The first target is
post-game coaching, not player identification or measurement-grade tracking.
This prototype has rink geometry, file contracts, a calibration overlay and
a local Game Viewer. It does **not** yet detect or track players or run live.

## Repository layout

| Directory | Purpose |
|---|---|
| `pipeline/` | Independent Python package and tests; no API or database required |
| `shared/` | Rink templates, sample calibrations and output schemas |
| `scripts/` | Optional sample clip retrieval |
| `apps/web/` | Local Game Viewer |
| `apps/api/` | Reserved for the API |
| `worker/`, `training/`, `infra/` | Reserved for background processing, training and deployment |
| `docs/` | [MVP spec](docs/spec.md) |

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
