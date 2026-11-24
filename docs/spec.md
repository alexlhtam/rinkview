# RinkView: Ice Hockey Positional Tracking for Coaches (MVP Spec)

Status: draft v3 · Owner: Alex (sole developer) · Target: post-game web app, running locally on a Windows PC with an RTX 4080 Super

---

## 1. Goals

### 1.0 Product principle
This is a **coaching and demonstration tool, not a measurement system**. A position that is right to within a stick length or two is good enough to show spacing, gaps and positioning errors. Choose clarity, speed and easy editing over pixel-perfect accuracy. When the tracking gets something wrong, the coach should be able to fix it or ignore it quickly, not wait for a better model.

### 1.1 Problem
Coaches at UK rinks record games on a single fixed camera. They have no affordable way to turn that footage into a top-down view of where players were, which they need for reviewing systems, spacing, forechecks and breakouts.

### 1.2 MVP goals
1. Upload a game video from a **fixed** camera (behind the goal on the glass, or a side tripod).
2. Calibrate the camera to the rink once per camera setup by clicking known rink landmarks.
3. Automatically detect and track players, then assign each one to Team A, Team B, Referee or Goalie.
4. Show a synced **video + 2D rink** view with player dots, trails, scrubbing and playback speed.
5. **Coaching board tools:** freeze any moment on the 2D rink, then annotate it (arrows, lines, zones, spotlights). Drag players to where they *should* have been ("ghost" positions) and save it as a teaching clip.
6. Analysis outputs: team and opponent heatmaps, zone time, average team shape, gaps between defenders, and CSV/JSON export.

### 1.3 Non-goals (MVP)
- Identifying individual players (jersey numbers or names).
- Puck tracking.
- Moving cameras (pan/tilt/zoom) or broadcast feeds.
- Combining several cameras.
- Live, in-game processing. The architecture must not block this later (see §11).
- Mobile apps, or logins with several organisations or users.

### 1.4 Success criteria (coaching grade)
| Metric | Target |
|---|---|
| Skaters on ice shown on the 2D rink | ≥ 85% of the time (≥ 70% in the far half for the behind-goal camera) |
| Position error (median) | ≤ 2 m (≤ 4 m in the far half for the behind-goal camera). Enough to show gaps, lanes and coverage. |
| Team assignment accuracy | ≥ 95% of track-frames after one-click fixes |
| ID consistency | Not a goal for MVP (team-level only). Short fragmented tracks are fine. |
| Processing time, 60-min game on the RTX 4080 Super | ≤ 30 min |
| Time from opening a game to the first annotated freeze-frame | ≤ 1 min |

---

## 2. Users and key flows

**Persona:** a coach or video analyst at a UK club, often not technical, working on a laptop after the game.

### Flow A: first-time setup for a rink and camera
1. Create a **Rink** by picking a preset (NHL 200×85 ft, IIHF 60×30 m, or Custom) and editing the dimensions to match.
2. Create a **Camera Setup** for that rink, e.g. "Planet Ice Altrincham – behind home goal".
3. Upload a short clip or a still frame and click 6–12 landmarks on the image, matched to the same points on a rink diagram.
4. The system computes a homography (the image-to-rink mapping) and shows an overlay of the rink lines drawn on the frame, plus the reprojection error. The user accepts or adjusts.
5. Optional: lens distortion calibration from a checkerboard video (§5.2).

### Flow B: process a game
1. Create a **Game** with date, opponent, and the jersey colour of each team (optional hint).
2. Upload one or more video files and pick the Camera Setup. If the camera may have moved, re-check the calibration.
3. Optional: mark the start and end of each period to skip intermissions.
4. Submit. A job is queued and the progress bar shows each stage.
5. When it finishes, the coach opens the Game Viewer.

### Flow C: review
- Video on the left, 2D rink on the right, both on one shared timeline.
- Toggle trails (last N seconds), team colours, refs on/off.
- Click a dot to highlight that track in the video.
- Fix team assignments: click a track and change its team, which applies to the whole track.
- Panels: heatmap per team, zone time (defensive, neutral and offensive zones, defined per period), average team position.
- Save **Clips**: named time ranges with a note, which can be exported.

### Flow D: teaching moment (core coaching use case)
1. While scrubbing, the coach spots a breakdown (e.g. weak-side D cheating, F3 too deep) and presses **Freeze**.
2. The 2D rink becomes a **tactics board**: draw arrows (skating or passing), lines (gaps, passing lanes), shaded areas (coverage zones), and spotlight or label players (e.g. "LD").
3. **Ghost mode:** drag one or more players to where they should have been. The original position stays as a faded marker, connected to the new one by a dashed arrow.
4. Optional **animated correction:** set ghost keyframes over a few seconds to show the correct movement; the app interpolates between them.
5. Save it as a **Teaching Clip**: time range, annotations and ghost positions, plus notes. Present it full-screen (for team meetings), or export it as PNG/MP4 for sharing (e.g. WhatsApp group).

### Flow E: opponent analysis
- Tag which team is "us" for each game. Filter heatmaps and shape views to the opponent only.
- Compare across games against the same opponent (later): e.g. their breakout shape, forecheck depth.
- Export positions as CSV or JSON, and the 2D animation as MP4 (later).

---

## 3. System architecture

```
                 ┌─────────────────────────┐
  Browser  ───►  │  Frontend (React + TS)  │
                 └──────────┬──────────────┘
                            │ REST/JSON + presigned uploads
                 ┌──────────▼──────────────┐       ┌─────────────┐
                 │  API (FastAPI)          │◄─────►│ Postgres    │
                 └──────────┬──────────────┘       └─────────────┘
                            │ enqueue job
                 ┌──────────▼──────────────┐       ┌─────────────┐
                 │  Queue (Redis + RQ)     │       │ Object store│
                 └──────────┬──────────────┘       │ (S3 / R2 /  │
                            │                      │  MinIO)     │
                 ┌──────────▼──────────────┐       └──────▲──────┘
                 │  GPU Worker (Python)    │──────────────┘
                 │  vision pipeline        │  read video, write
                 └─────────────────────────┘  tracks/parquet
```

### 3.1 Tech choices (solo-dev friendly)
| Layer | Choice | Why |
|---|---|---|
| Frontend | React + TypeScript + Vite, Tailwind, Zustand for state | Quick to build, large ecosystem |
| 2D rink drawing | HTML Canvas (or PixiJS if it gets slow) | Draws 20+ dots at 30 fps easily |
| Charts | Visx or plain canvas for heatmaps | Light dependency |
| API | FastAPI + Pydantic + SQLAlchemy + Alembic | Same Python as the pipeline |
| DB | Postgres | Metadata, calibrations, games, jobs |
| Position data | Parquet files in the object store, one per video | Millions of rows, read in bulk |
| Queue | Redis + RQ | Simpler than Celery for one worker |
| Vision | PyTorch, Ultralytics YOLO, `supervision`, OpenCV, ByteTrack | Proven, well documented |
| Storage | S3-compatible (Cloudflare R2 or MinIO locally) | Large video files |
| Deploy | Docker Compose: api, worker, db, redis, minio on the Windows PC | All local. Coaches use it via a browser on the LAN, or remotely through Tailscale or a Cloudflare Tunnel. |
| GPU | **Local RTX 4080 Super (16 GB)** on Alex's Windows PC | No cloud cost. Enough VRAM for YOLO-m/l at 1280 with batching. |
| Host OS | **Windows 11 + WSL2 (Ubuntu) + Docker Desktop with GPU support** | Linux tools and CUDA in containers. Same images can move to a Linux server later. |

### 3.2 Repo layout (monorepo)
```
rinkview/
  apps/
    web/                 # React frontend
    api/                 # FastAPI service
  pipeline/              # Python vision package (importable, CLI-runnable)
    rinkview_cv/
      io/                # video decode, frame sampling
      calib/             # intrinsics, homography, rink templates
      detect/            # YOLO wrapper
      track/             # ByteTrack wrapper, track post-processing
      teams/             # team classifier
      project/           # image -> rink coords, filtering
      analytics/         # heatmaps, zone time, shape
      export/
    cli.py               # `rinkview process video.mp4 --calib cam.json --out data/results`
  worker/                # RQ worker entrypoint wrapping pipeline
  training/              # dataset tools, label conversion, train/eval scripts
  shared/
    rink_templates/      # JSON rink definitions
    schemas/             # JSON schema for positions export
  infra/
    docker-compose.yml
  docs/
```
**Key rule:** `pipeline/` has no dependency on the API or DB. It takes a video file and a camera config and produces Parquet/JSON, so it can be run and tested from the CLI on its own.

---

## 3a. Camera hardware recommendations
None chosen yet. Requirements:
| Requirement | Why |
|---|---|
| **4K at 25/30 fps** (1080p minimum for the side view) | Far players need enough pixels to be detected |
| **Linear or rectilinear mode, no fisheye** | Lines stay straight, so less distortion correction is needed |
| **Fixed focus, locked exposure and white balance** | Ice glare and rink lighting cause hunting, which changes colours (bad for team classification) |
| **Battery or USB power for ≥ 70 min, or mains power** | Covers a full game plus warm-up |
| **Rigid mount** | A heavy-duty suction mount with a safety tether on the glass, or a tall tripod (≥ 2.5 m) or clamp at the highest spot available |

Candidate types (verify current models and prices before buying):
- **Action camera** (e.g. GoPro or DJI Osmo Action) in linear 4K mode. Portable and easy on glass. Watch for overheating and battery life over a full game.
- **4K security camera / IP camera** (PoE). Cheap, runs for hours, and supports RTSP, which is useful for future live mode. Needs mains power or a power bank.
- **Phone on a tripod** (recent iPhone or Pixel at 4K30). Good fallback; zero cost if you already have one.

Mounting guidance: **height matters more than resolution**. A side camera at mid-ice, as high as possible, filming the whole rink gives the most even accuracy. Behind the glass, mount as high as possible and put the lens flush against the glass to reduce reflections.

---

## 3b. Findings from sample footage (Yetis v Dragons, P1–P3)
Source: three YouTube videos, one per period. The originals are **3840×2160 at 59.94 fps**, about 32 min each. I tested 3-minute sections (10:00–13:00 of each period) at full 4K.

**Off-the-shelf detector test** (YOLO11m with COCO "person" weights, no fine-tuning, CPU):
- Nearly every on-ice skater, both goalies (including the far-end one) and the referees were detected at 4K. On-ice players are about 90–150 px tall, which is comfortable for detection.
- About half of all detections were **not on-ice players**: bench players, staff, the penalty box, spectators in the foreground. The ice mask and foot-point filter are essential.
- Running the whole frame at 1280 and running the cropped ice band in tiles gave similar on-ice recall at 4K. Tiling matters more if recording at 1080p.
- Fine-tuning is still needed for: players overlapping at the boards, telling refs apart from players (no ref class in COCO), and dropping bench people.

**Setup observed:** a side view from the stands at about centre ice, a few rows up (low elevation). The camera captures the whole rink end to end. Rink markings are clearly visible: the red line, both blue lines, centre and end faceoff circles, both nets and creases. That is plenty of landmarks for calibration. The ice is evenly lit and colours are good.

| Observation | Impact | Spec change |
|---|---|---|
| Ice fills only about 20% of frame height (about y 1270–1720 at 4K). Roof, crowd and seats fill the rest. | At 4K players are still 90–150 px tall, so this is fine. At 1080p it would be marginal. | **Crop to the ice region before detection**, then use tiled or sliced inference (e.g. SAHI) at full native resolution. Record at 4K. Zoom or frame tighter so the rink fills the width. |
| Low camera angle | The rink's width (side to side) is squashed into about 100 px at 720p, so errors in the y direction (across the rink) are about 3–5× larger than along its length | Accept for coaching. Show a confidence band. A higher mount is the biggest single improvement. |
| Near-side boards, glass posts, benches and staff block the bottom of near-side players | Skate (foot) point hidden, which gives the wrong projected position | **Foot-point fallback:** when the bottom of a box is hidden behind the near boards (using a boards line from calibration), estimate the foot point from the head point minus typical player height in pixels at that image position (a lookup table learnt from unoccluded players). |
| Benches, penalty box, staff and spectators overlap the ice in the image | Detector picks up non-players | Ice mask checks the **estimated** foot point (after fallback), not the raw box bottom. Add bench and box zones. Label bench people as negatives during training. |
| Framing differs slightly between the three periods (camera re-placed or moved) | One calibration per game is not enough | **Calibrate per video file (per period)**, with "copy from previous period and nudge" in the UI. Turn on drift detection (§5.3) by default. |
| Far-end net and players are small but visible | Usable at coaching-grade accuracy | No change |
| Real footage is split into one file per period | Matches Flow B | One Game holds several Videos, each tagged with its period number. |

**Verdict (confirmed on the 4K footage):** this footage is workable for the coaching-grade goal. The main jobs are cropping to the ice, sliced detection, and handling near-side occlusion. M0 should use these three videos as the first test set.

---

## 4. Rink model

### 4.1 Coordinate system
- Units are **metres**. The origin is centre ice, +x points toward the right-hand goal as seen from the camera setup's "home" end, and +y points toward the far boards.
- Each rink is defined by a template JSON file:
```json
{
  "id": "custom-uk-56x26",
  "length_m": 56.0,
  "width_m": 26.0,
  "corner_radius_m": 8.5,
  "goal_line_from_end_m": 4.0,
  "blue_line_from_centre_m": 8.5,
  "faceoff_circle_radius_m": 4.5,
  "end_faceoff": {"from_goal_line_m": 6.0, "from_centre_y_m": 7.0},
  "neutral_faceoff": {"from_blue_line_m": 1.5, "from_centre_y_m": 7.0}
}
```
- Presets: NHL (60.96×25.91 m), IIHF (60×30 m), and Custom. Every landmark position is **derived** from these parameters.

### 4.2 Landmark set used for calibration
Centre faceoff dot; the 4 neutral-zone dots; the 4 end-zone dots; the points where the goal lines, blue lines and centre line meet the boards (where visible); goal posts (base); and the ends of the trapezoid (if marked). Each landmark has an ID, so the click UI and the pipeline share the same list.

---

## 5. Calibration

### 5.1 Homography (required)
- Input: at least 4 (recommended 6–12) pairs of image point and rink point, spread across the visible ice.
- Fit with `cv2.findHomography(..., RANSAC)` on **undistorted** points.
- Show the fit quality: per-point reprojection error in metres, and the rink line overlay drawn on the frame.
- Store on `CameraSetup`: `H` (3×3), the point pairs, the image size, and the RMS error.
- **Visible ice mask:** a polygon of the area the camera can see. Detections outside it (crowd, bench, penalty box) are dropped. The user can draw it, or it defaults to the rink outline projected into the image.
- **Bench and box zones (optional):** polygons in rink coordinates. Tracks inside them are labelled "off-ice", which helps with line changes.

### 5.2 Lens distortion (recommended for the behind-glass camera)
- Calibrate each physical camera once (e.g. "GoPro Hero 11, Wide"): record a checkerboard, then run `cv2.calibrateCamera` to get K and distortion coefficients.
- Store as a `CameraDevice` and reuse across setups.
- If skipped, fall back to the identity (no correction). Warn the user if the reprojection error is above 0.5 m.

### 5.3 Drift detection
A suction-cup mount can sag during a game. Every N seconds, compare ORB features in a ring of static background (glass edge, boards, logos) against the calibration frame. If the median shift is more than X px, either:
- **MVP:** flag the time range in the job report ("camera moved at 34:12, recalibrate"), or
- **v1.1:** automatically re-estimate the homography from the feature matches, chaining it to the original.

---

## 6. Vision pipeline

### 6.1 Stages
| # | Stage | Input → Output | Notes |
|---|---|---|---|
| 1 | Decode | video → frames | PyAV/FFmpeg, process at the native frame rate (25/30). Skip marked intermissions. |
| 2 | Undistort | frame → frame | Only if a CameraDevice exists. Undistorting points only (not full frames) is cheaper; prefer that. |
| 2b | Crop | frame → ice region | Crop to the bounding box of the ice mask (plus a margin). |
| 3 | Detect | frame → boxes `{cls, conf, xyxy}` | YOLO (v8/11, size s or m) fine-tuned. Classes: `player`, `goalie`, `referee`. Image size 1280 for the behind-goal camera (small far players). Optional tiled inference for the far zone. |
| 4 | Ice mask filter | boxes → boxes | Drop boxes whose foot point is outside the visible ice polygon. |
| 5 | Track | boxes → tracks `{track_id, frame, box}` | ByteTrack via `supervision`, with tuned buffer length (e.g. 2 s) to survive short occlusions. |
| 6 | Team classify | track crops → team label | See §6.2. |
| 7 | Foot point | box → image point | Bottom-centre of the box, nudged up ~3% of box height. If the box bottom is hidden behind the near boards, estimate it from the head point and the learnt player-height table (§3b). |
| 8 | Project | image pt → rink pt (m) | `cv2.perspectiveTransform` with H. Clamp to the rink outline with a tolerance. |
| 9 | Smooth and stitch | raw rink tracks → clean tracks | Constant-velocity Kalman filter in rink coordinates (max speed ~12 m/s). Join track fragments when the gap is < 3 s and same team and the distance is reachable. Drop tracks shorter than 1 s. |
| 10 | Resample | → fixed 10 Hz series | Positions stored at 10 Hz for the viewer. Full frame rate kept optionally for analysis. |
| 11 | Analytics | tracks → aggregates | Heatmaps, zone time, team centroid and spread. |
| 12 | Write outputs | → Parquet + JSON summary + debug video | Debug video (optional): boxes, IDs and team colours drawn on the footage, with a 2D minimap inset. Very valuable for QA. |

### 6.2 Team classification
1. Sample about 5 crops per track (the most confident boxes). Crop the **upper 60%** of the box (the jersey, not the ice or pants).
2. Embed each crop with: (a) an HSV colour histogram after masking out ice-white pixels, as the MVP baseline, or (b) SigLIP/CLIP image embeddings, as the upgrade.
3. Cluster all track embeddings for the game with K-Means, K=2 for skaters. Referees are a separate detector class, which avoids a lot of confusion with striped shirts.
4. Goalies are a detector class. Assign each goalie to a team by which end it spends most of its time at, per period.
5. If the user gave jersey colours, use them to name the clusters "Home" and "Away". Otherwise name them "Team A" and "Team B" and let the user rename and swap.
6. Take a majority vote across the whole track. Corrections in the UI override per track.

**Edge cases:** white jerseys against the ice (mask carefully); similar dark colours (fall back to embeddings); third-jersey teams.

### 6.3 Output schema
`positions.parquet` (one row per track sample):
| column | type | notes |
|---|---|---|
| t | float64 | seconds from video start |
| frame | int32 | source frame |
| track_id | int32 | stable within the video after stitching |
| role | enum | player / goalie / referee |
| team | enum | A / B / none |
| x_m, y_m | float32 | rink coordinates |
| vx, vy | float32 | from the Kalman filter, m/s |
| conf | float32 | detection × tracking confidence |
| on_ice | bool | false if inside a bench or box zone |
| interpolated | bool | true if filled across a gap |

`summary.json`: per-period zone time, heatmap grids (e.g. 1 m cells), track counts, processing stats, drift warnings.

### 6.4 Performance budget (RTX 4080 Super, to be measured in M0)
A 60 min game at 30 fps is 108k frames. YOLO-m at 1280 with batching on a 4080 Super should run at roughly 100–200 fps, which is about 10–20 min of detection (estimate, confirm in M0). Exporting to TensorRT could make it faster. Processing at 15 fps halves the time and is plenty for coaching. Decoding 4K video can become the bottleneck, so use NVDEC hardware decoding (PyAV/FFmpeg with `-hwaccel cuda`) or downscale on decode.

**Windows notes:**
- Run the worker in WSL2 or Docker with `--gpus all`. Install the NVIDIA Windows driver only (no CUDA inside WSL beyond the container).
- Store videos on the WSL2 filesystem (ext4), not `/mnt/c`, because cross-filesystem reads are slow.
- If WSL2 GPU passthrough gives trouble, fall back to native Windows Python with the CUDA build of PyTorch. The pipeline package must stay OS-agnostic (pathlib, no shell-specific calls).

---

## 7. ML data and training plan

### 7.1 Datasets
| Source | Use | Volume | Notes |
|---|---|---|---|
| Public hockey datasets (e.g. Roboflow Universe hockey player sets) | Initial fine-tune | whatever is available | Check each licence |
| **Own footage, side tripod** | Main training and eval | 300–500 frames to start | Sample diverse moments: faceoffs, scrums, line changes |
| **Own footage, behind goal** | Main training and eval | 300–500 frames | Include far-end small players |
| NHL broadcast (hand-picked angles) | Extra training data for the detector only | 200–500 frames | Private training only, do not redistribute (copyright). Prefer high, wide shots. |

### 7.2 Labelling
- Tool: CVAT (self-hosted) or Roboflow (hosted, free tier). Export in YOLO format.
- Classes: `player`, `goalie`, `referee`. Box covers helmet to skate blade.
- Pre-label with the off-the-shelf COCO "person" model, then correct by hand. This is about 3–5× faster.
- Eval set: about 100 frames per camera type, **from different games** than training (avoids testing on the same game you trained on).
- Position ground truth (for the metres targets): hand-label the foot points of about 20 frames per camera type, then project them with a carefully hand-checked calibration.

### 7.3 Training
- Start from COCO-pretrained YOLO weights and fine-tune with `training/train_detector.py` (Ultralytics). Train on a local GPU or rented time; a few hours is enough.
- Track experiments with Ultralytics' built-in logging, or Weights & Biases on the free tier.
- Version models: `models/detector/vYYYYMMDD.pt`, recorded on each job, so results can be reproduced.

### 7.4 Evaluation harness
`training/eval.py` reports, per camera type: detection mAP and recall, tracking HOTA/IDF1 (via TrackEval) on 2–3 short clips labelled with tracks, position error in metres, and team accuracy. Run it before switching to a new model.

---

## 8. Data model (Postgres)

```
Rink(id, name, template_json, created_at)
CameraDevice(id, name, K, dist_coeffs, image_w, image_h)
CameraSetup(id, rink_id, camera_device_id?, name, position_kind[behind_goal|side],
            homography, point_pairs_json, ice_mask_polygon, zones_json,
            reprojection_rms_m, reference_frame_key, created_at)
Team(id, name, primary_color, secondary_color)
Game(id, date, home_team_id, away_team_id, rink_id, notes)
Video(id, game_id, camera_setup_id, object_key, duration_s, fps, w, h,
      period_marks_json, uploaded_at)
Job(id, video_id, status[queued|running|done|failed], stage, progress,
    model_version, params_json, error, started_at, finished_at)
TrackMeta(id, video_id, track_id, role, team, team_overridden, start_t, end_t)
Clip(id, video_id, start_t, end_t, title, note, created_at)
TeachingClip(id, video_id?, start_t, end_t, title, notes, tags[],
             annotations_json, ghosts_json, hidden_track_ids[], added_players_json,
             created_at, updated_at)
  # annotations_json: [{id, kind: arrow|pass|line|pen|zone|label|spotlight|measure,
  #                     t_from, t_to, points_m: [[x,y],...], style}]
  # ghosts_json: [{track_id|null, team, keyframes: [{t, x_m, y_m}]}]
```
Position samples live in Parquet (`videos/{id}/positions.parquet`), not in Postgres.

---

## 9. API (FastAPI, REST)

| Method | Path | Purpose |
|---|---|---|
| POST | /rinks, GET /rinks, GET/PATCH /rinks/{id} | Rink CRUD |
| GET | /rink-templates | Presets |
| POST | /camera-setups, GET/PATCH /camera-setups/{id} | Calibration CRUD |
| POST | /camera-setups/{id}/solve | Body: point pairs → returns H, per-point error, overlay PNG |
| POST | /games, GET /games, GET /games/{id} | Games |
| POST | /videos/upload-url | Presigned multipart upload URL |
| POST | /videos | Register an uploaded video (game, camera setup, period marks) |
| GET | /videos/{id}/frame?t= | Single JPEG frame (for calibration UI) |
| POST | /videos/{id}/jobs | Start processing |
| GET | /jobs/{id} | Status and progress (poll every 2 s; SSE later) |
| GET | /videos/{id}/positions?from=&to=&hz= | Position samples (Arrow/JSON, chunked by time window) |
| GET | /videos/{id}/summary | Analytics JSON |
| PATCH | /videos/{id}/tracks/{track_id} | Override team or role |
| POST/GET | /videos/{id}/clips | Clips |
| GET | /videos/{id}/export.csv | Export |
| POST/GET/PATCH/DELETE | /teaching-clips[/{id}] | Teaching clips with annotations and ghosts |
| POST | /teaching-clips/{id}/render | Queue an MP4 render, then return a download URL |

Auth for MVP: a single-user password or a magic link (e.g. FastAPI-Users). Clubs and multiple users come later.

---

## 10. Frontend

### 10.1 Pages
1. **Rinks and Cameras:** list of rinks; rink editor with live diagram preview.
2. **Calibration Studio:** frame on the left, rink diagram on the right. Click a landmark on the diagram, then its matching spot on the frame. Live overlay of rink lines drawn on the frame, error per point, ice mask polygon tool, zoom/pan.
3. **Games:** list; create game; upload with progress (resumable multipart).
4. **Job status:** stage-by-stage progress, logs, link to the debug video.
5. **Game Viewer (core screen):**
   - `<video>` element and the rink canvas, kept in sync by `requestVideoFrameCallback`, looking up the nearest 10 Hz sample.
   - Timeline with period markers, clip markers and density of activity.
   - Controls: play, pause, 0.25×–2× speed, frame step, trail length, show/hide teams, refs, and track IDs.
   - Click a dot to highlight its box in the video (draw box overlay from the stored box data, optional).
   - Side panel: heatmaps (per team, per period), zone time bars, team centroid lines.
   - Track editor: list of tracks with team colour chips, click to reassign.
   - Clip creation: press I/O for in/out points, then add a title and note.
6. **Tactics Board / Teaching Clip editor** (opened via Freeze in the Game Viewer, or standalone with a blank rink):
   - Tools: arrow (solid = skate, dashed = pass), line, freehand pen, rectangle or polygon zone (semi-transparent), text label, player spotlight, measure tool (distance between two players, in metres).
   - Ghost players: drag a dot to create a ghost, with a dashed link back to the original.
   - Keyframed ghost animation over a short range (linear or smooth interpolation).
   - Add players by hand (to cover tracking gaps), and hide players that were detected by mistake.
   - Layers: tracked players, ghosts, annotations, each toggleable.
   - Presentation mode: full-screen, large dots, high contrast, works on a TV or projector.
7. **Teaching Clip library:** list per game and across games, tags (e.g. "D-zone coverage", "breakout"), share link (read-only, for the local network or tunnel).
8. **Export:** CSV/JSON download; PNG of a frozen board; MP4 of the rink animation with annotations (rendered on the server with the same drawing code, or client-side via `MediaRecorder` on the canvas).

### 10.2 Rink rendering
- Rink drawn as an SVG background generated from the template JSON (same parameters as the pipeline).
- Players drawn on a canvas layer above it: team colour fill, outline for goalies, grey for refs.
- Load position data in 60 s windows around the playhead; preload the next window.

---

## 11. Path to live use (not in MVP, but designed for)
- The pipeline is written as **streaming stages working frame by frame** (generator chain), not as passes over whole files. The batch job is the same code on a file source.
- Team classification is fitted on the first N seconds, then frozen for live use.
- A future "Live" mode: an RTSP/USB camera feeds a laptop with an NVIDIA GPU or a Jetson Orin, the pipeline runs at 15 fps and YOLO-s, and positions go over WebSocket to a tablet showing the rink canvas.
- Kalman smoothing must then run without seeing future frames (filter only, no smoother), so keep both options.

---

## 12. Milestones (solo developer, part-time estimates)

| # | Milestone | Deliverable | Est. |
|---|---|---|---|
| M0 | Footage and feasibility | Pick or borrow a camera, record 2–3 games from each position. Set up WSL2, Docker and GPU on the 4080 Super. Run off-the-shelf YOLO + ByteTrack in a notebook and measure frame rate and quality. | 1–2 wks |
| M1 | CLI pipeline v0 | `rinkview process` with a calibration JSON from the CLI. Outputs Parquet and a debug video with minimap. **Go/no-go:** is it good enough to show positioning to a coach? | 2–3 wks |
| M2 | Custom detector | Label about 600 frames, fine-tune, simple eval. | 2 wks |
| M3 | Teams and post-processing | Team classifier, stitching, smoothing, zones, summary.json. | 2 wks |
| M4 | Backend | FastAPI, Postgres, MinIO, RQ worker, Docker Compose on the Windows PC. | 2 wks |
| M5 | Frontend core | Calibration Studio and Game Viewer (synced video and rink). | 3 wks |
| M6 | **Tactics board and teaching clips** | Freeze, annotations, ghosts, presentation mode, PNG export. | 2–3 wks |
| M7 | Analysis and polish | Heatmaps, zone time, team shape, opponent filter, MP4 export, remote access via a tunnel, pilot with one coach. | 2 wks |

**Total: roughly 4–5 months part-time.** The relaxed accuracy targets mean M2 can be lighter. Move time to M6, which is where the coaching value is.

**Shortcut option:** the tactics board (M6) works without any tracking (blank rink, add players by hand). It could be built first as a standalone tool that is useful on its own while the vision pipeline matures.

---

## 13. Risks and mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Far-end players are tiny in the behind-goal view | Poor recall and position | Image size 1280+, tiled inference on the far zone, recommend a higher mount, mark the far half as "low confidence" in the UI |
| Occlusion near the net and boards | ID switches | Track stitching, accept fragmented IDs (team-level only, so the impact is low) |
| Glass reflections and smudges | False detections | Ice mask, confidence threshold, labelled negatives, lens hood or flush mount |
| Camera bumped mid-game | Wrong positions | Drift detection (§5.3), recalibration prompt |
| Similar team colours | Wrong team labels | Embedding-based classifier, user override per track |
| NHL footage licensing | Legal exposure if commercialised | Keep it to private training; replace with own data before selling |
| GPU cost and availability | Slow processing | Process at 15 fps; rent GPU per job; TensorRT |
| Solo dev scope creep | Delay | Strict non-goals; CLI-first; ship to one coach early |

---

## 14. Open questions / decisions to make
1. **Camera hardware:** not chosen. See §3a. Suggest testing with a phone at 4K first (M0) before buying anything.
2. **Mount height:** can the side tripod go high (e.g. on the stands or a gantry)? Higher means much better accuracy.
3. **Hosting:** decided. Local Windows PC with an RTX 4080 Super. Still open: should coaches reach it remotely (tunnel) or only on the LAN? Does the PC need to be on whenever coaches want access?
4. **Retention:** keep source video or delete it after processing? Storage cost is about 4–8 GB per game at 1080p.
5. **Privacy/GDPR:** footage of youth players needs club consent and a retention policy before any pilot with juniors.
6. **Naming:** "RinkView" is a placeholder.
