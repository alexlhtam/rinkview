import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { FormEvent, Ref } from 'react';
import { TacticsBoard, parseClip } from '@rinkview/tactics-board/source';
import type { TeachingClip } from '@rinkview/tactics-board/source';
import type { GameData } from './data';
import type { Team } from './contracts';
import { TrackRink } from './Rink';
import { SAMPLE_HZ, MAX_TRAIL_SECONDS, effectiveTeam, findSample } from './samples';
import { usePlayback, usePositionWindow } from './playback';
import { useViewSettings } from './viewSettings';
import { Insights } from './Insights';
import { makeClip } from './clips';
import type { Clip } from './clips';
import { activityBars } from './timeline';
import { canDiscardTeachingDraft, switchTeachingDraft, teachingFrame } from './teaching';
import type { TeachingDraft } from './teaching';
import { TEAM_COLORS } from './rinkGeometry';

const FILTERS = [
  { key: 'A', label: 'Team A' },
  { key: 'B', label: 'Team B' },
  { key: 'referee', label: 'Refs' },
  { key: 'none', label: 'Unassigned' },
] as const;

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

function stamp(value: number, precise = false) {
  const ms = Math.round(Math.max(0, value) * 1000);
  return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${precise ? '.' + String(ms % 1000).slice(0, -1).padStart(2, '0') : ''}`;
}

function PlayIcon({ playing }: { playing: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 20 20" width="17" height="17" fill="currentColor">
    {playing ? <path d="M5 4h4v12H5zm6 0h4v12h-4z" /> : <path d="M6 3.5 16 10 6 16.5z" />}
  </svg>;
}

function FrameIcon({ back }: { back?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 20 20" width="17" height="17" fill="currentColor"
    style={{ transform: back ? 'scaleX(-1)' : undefined }}><path d="M5 4.5 13 10l-8 5.5zm9 0h1.8v11H14z" /></svg>;
}

export interface ViewerHandle {
  confirmDiscardDraft(): boolean;
}

export function Viewer({ game, ref }: { game: GameData; ref?: Ref<ViewerHandle> }) {
  const { videoRef, time, duration, playing, speed, error, seek, step, toggle, changeSpeed, pauseAtDisplayedFrame } = usePlayback();
  const { samples, windowError } = usePositionWindow(game.positions, time);
  const { filters, toggleFilter, trails, setTrails, ids, toggleIds } = useViewSettings();
  const [selected, setSelected] = useState<number | null>(null);
  const [overrides, setOverrides] = useState(new Map<number, Team>());
  const [inPoint, setIn] = useState<number | null>(null);
  const [outPoint, setOut] = useState<number | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [board, setBoard] = useState<(Awaited<ReturnType<typeof teachingFrame>> & { revision: number }) | null>(null);
  const [boardError, setBoardError] = useState('');
  const [boardPending, setBoardPending] = useState(false);
  const boardTitle = useRef<HTMLHeadingElement>(null);
  const freezeButton = useRef<HTMLButtonElement>(null);
  const teachingInput = useRef<HTMLInputElement>(null);
  const boardRevision = useRef(0);
  const boardDraft = useRef<TeachingDraft | null>(null);
  const sample = findSample(samples, time);
  const dots = useMemo(() => sample?.positions.filter(p => p.on_ice && filters[p.role === 'referee'
    ? 'referee' : effectiveTeam(p, overrides)]) ?? [], [filters, overrides, sample]);

  const track = game.tracks.find(p => p.track_id === selected);
  const hasUnassigned = game.tracks.some(p => p.role !== 'referee' && p.team === 'none') || [...overrides.values()].includes('none');
  const fps = game.fps ?? 30;
  const percent = (t: number) => duration ? Math.min(100, t * 100 / duration) : 0;
  const bars = useMemo(() => activityBars(game.activity, duration), [game.activity, duration]);
  const soloPeriod = game.summary.periods.length === 1 ? game.summary.periods[0].period : undefined;

  useImperativeHandle(ref, () => ({
    confirmDiscardDraft: () => canDiscardTeachingDraft(boardDraft.current,
      () => window.confirm('Discard unsaved Teaching Clip edits and open these game files?')),
  }), []);

  useEffect(() => {
    if (board) return;
    function hotkey(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat
        || (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.closest('input, select, textarea')))) return;
      const key = event.key.toLowerCase();
      if (key !== 'i' && key !== 'o') return;
      const video = videoRef.current;
      if (!video || !video.duration) return;
      if (key === 'i') setIn(video.currentTime);
      else setOut(video.currentTime);
    }
    window.addEventListener('keydown', hotkey);
    return () => window.removeEventListener('keydown', hotkey);
  }, [board, videoRef]);

  useEffect(() => {
    if (board) boardTitle.current?.focus();
  }, [board]);

  async function openBoard(loaded?: TeachingClip) {
    const startedAt = pauseAtDisplayedFrame();
    const next = await teachingFrame(game, startedAt, duration, overrides, loaded);
    const draft = switchTeachingDraft(boardDraft.current, next.clip, Boolean(loaded), fps,
      () => window.confirm('Discard unsaved edits to the current Teaching Clip?'));
    if (!draft) return;
    boardDraft.current = draft;
    if (loaded) seek(next.clip.start_t);
    setBoard({ ...next, clip: draft.clip, revision: ++boardRevision.current });
  }

  function updateBoardClip(clip: TeachingClip) {
    if (boardDraft.current) boardDraft.current = { ...boardDraft.current, clip };
  }

  function markBoardClipSaved(clip: TeachingClip) {
    if (boardDraft.current) boardDraft.current = { clip, savedClip: clip };
  }

  async function showBoard(file?: File) {
    setBoardError('');
    setBoardPending(true);
    try {
      await openBoard(file ? parseClip(await file.text()) : undefined);
    } catch (cause) {
      setBoardError(cause instanceof Error ? cause.message : 'Could not open the tactics board.');
    } finally {
      setBoardPending(false);
    }
  }

  function saveClip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const clip = makeClip(inPoint, outPoint, String(fields.get('title')), String(fields.get('note')));
    if (!clip) return;
    setClips(current => [...current, clip]);
    setIn(null);
    setOut(null);
    form.reset();
  }

  function exportClips() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(clips, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'rinkview-clips.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <>
      {board && <section className="teaching-panel" aria-labelledby="teaching-title">
        <div className="panel-head">
          <div><h2 id="teaching-title" ref={boardTitle} tabIndex={-1}>Frozen frame · {stamp(board.clip.start_t, true)}</h2>
            <p>{board.players.length ? `${board.players.length} tracked players from the nearest sample.`
              : 'No tracks at this timestamp. Add players manually or return to the video.'}</p></div>
          <button onClick={() => {
            setBoard(null);
            requestAnimationFrame(() => freezeButton.current?.focus());
          }}>Back to video</button>
        </div>
        <TacticsBoard key={board.revision} rinkTemplate={game.rink}
          initialPlayers={board.players} initialClip={board.clip} onOpenClip={openBoard}
          onChange={updateBoardClip} onSaveClip={markBoardClipSaved} teamColors={TEAM_COLORS} />
      </section>}
      <div hidden={Boolean(board)}>
      <div className="workspace">
        <div className="stage-grid">
          <section className="stage video-stage" aria-labelledby="video-title">
            <div className="stage-head">
              <h2 id="video-title"><span className="view-index">01</span> Match video</h2>
              <span className="micro status"><i />{playing ? 'PLAYING' : 'PAUSED'}</span>
            </div>
            <div className="viewport">
              <video ref={videoRef} src={game.videoUrl} preload="auto" playsInline aria-label="Match video" />
              {error && <p className="media-error" role="alert">{error}</p>}
            </div>
          </section>
          <section className="stage rink-stage" aria-labelledby="rink-title">
            <div className="stage-head">
              <h2 id="rink-title"><span className="view-index">02</span> Tracking view</h2>
              <span className="micro">{game.rink.length_m} × {game.rink.width_m} M</span>
            </div>
            <div className="rink-viewport">
              <TrackRink rink={game.rink} samples={samples} sample={sample} dots={dots} trails={trails} selected={selected}
                overrides={overrides} ids={ids} onSelect={setSelected} />
            </div>
            <div className="rink-caption"><span>{windowError || `${dots.length} visible tracks`}</span>
              <span>10 Hz · nearest sample · dashed = interpolated</span></div>
          </section>
        </div>
        <section className="timeline" aria-label="Shared timeline">
          <div className="timeline-label"><span className="micro">SHARED TIMELINE</span>
            <span className="time-readout"><strong>{stamp(time, true)}</strong> / {stamp(duration)}</span></div>
          <div className="timeline-track">
            <div className="activity-bars" title="Relative movement intensity" aria-hidden="true">
              {bars.map(({ left, width, height }, i) => <i key={i}
                style={{ left: `${left}%`, width: `${width}%`, height: `${height}%` }} />)}
            </div>
            <div className="clip-markers" aria-hidden="true">{clips.map((clip, i) => <i key={i}
              title={clip.title} style={{ left: `${percent(clip.start_s)}%`, width: `${percent(clip.end_s) - percent(clip.start_s)}%` }} />)}</div>
            <div className="timeline-progress" aria-hidden="true" style={{ width: `${percent(time)}%` }} />
            <input aria-label="Timeline" type="range" min={0} max={duration || 1} step="any" value={Math.min(time, duration)}
              aria-valuetext={stamp(time, true)} disabled={!duration} onChange={event => seek(Number(event.target.value))} />
          </div>
          <div className="timeline-ticks"><span>{soloPeriod !== undefined ? `P${soloPeriod} · ` : ''}00:00</span>
            <span>{stamp(duration / 2)}</span><span>{stamp(duration)}</span></div>
          <div className="control-row">
            <div className="controls transport">
              <button className="primary play-button" onClick={() => void toggle()} disabled={!duration} aria-label={playing ? 'Pause' : 'Play'}>
                <PlayIcon playing={playing} />{playing ? 'Pause' : 'Play'}
              </button>
              <button className="icon-button" aria-label="Previous frame" title={`Step back at ${fps.toFixed(2)} fps`}
                disabled={!duration} onClick={() => step(-1, fps)}><FrameIcon back /></button>
              <button className="icon-button" aria-label="Next frame" title={`Step forward at ${fps.toFixed(2)} fps`}
                disabled={!duration} onClick={() => step(1, fps)}><FrameIcon /></button>
              <select aria-label="Playback speed" value={speed} onChange={event => changeSpeed(Number(event.target.value))}>
                {RATES.map(rate => <option key={rate} value={rate}>{rate}×</option>)}
              </select>
            </div>
            <div className="controls view-controls">
              <label className="trail-control">Trails <select aria-label="Trail length" value={trails} onChange={event => setTrails(Number(event.target.value))}>
                <option value={0}>Off</option>{Array.from({ length: MAX_TRAIL_SECONDS }, (_, i) =>
                  <option key={i + 1} value={i + 1}>{i + 1} s</option>)}
              </select></label>
              {FILTERS.filter(filter => filter.key !== 'none' || hasUnassigned).map(({ key, label }) =>
                <button key={key} className="filter-button" aria-pressed={filters[key]} onClick={() => toggleFilter(key)}>
                  <i className={`team-dot team-${key}`} />{label}</button>)}
              <button className="filter-button" aria-pressed={ids} onClick={toggleIds}>IDs</button>
            </div>
          </div>
          <div className="controls teaching-actions">
            <button className="primary" ref={freezeButton} onClick={() => void showBoard()} disabled={!duration || boardPending}>
              Freeze → Tactics board
            </button>
            <button onClick={() => teachingInput.current?.click()} disabled={!duration || boardPending}>Open Teaching Clip</button>
            <input ref={teachingInput} type="file" accept=".json,application/json" aria-label="Open Teaching Clip JSON"
              hidden onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void showBoard(file);
              }} />
            {boardError && <span role="alert">{boardError}</span>}
          </div>
        </section>
      </div>

      <section className="track-strip panel" aria-label="Track editor">
        <div className="track-intro"><h2>Track editor</h2><p>Select a dot or choose a track to adjust its team.</p></div>
        <div className="controls">
          <label className="field-inline">Track
            <select value={selected ?? ''} onChange={event => setSelected(event.target.value === '' ? null : Number(event.target.value))}>
              <option value="">Select a track</option>
              {game.tracks.map(p => <option key={p.track_id} value={p.track_id}>
                #{p.track_id} · {p.role === 'referee' ? 'Referee' :
                  `${effectiveTeam(p, overrides) === 'none' ? 'Unassigned' : 'Team ' + effectiveTeam(p, overrides)}${p.role === 'goalie' ? ' goalie' : ''}`}
              </option>)}
            </select>
          </label>
          {track && track.role !== 'referee' && <label className="field-inline">
            Team override
            <select value={overrides.get(track.track_id) ?? ''} onChange={event => {
              const value = event.target.value as Team | '';
              setOverrides(current => {
                const next = new Map(current);
                if (value) next.set(track.track_id, value);
                else next.delete(track.track_id);
                return next;
              });
            }}>
              <option value="">Original</option><option value="A">Team A</option>
              <option value="B">Team B</option><option value="none">Unassigned</option>
            </select>
          </label>}
        </div>
      </section>

      <Insights game={game} />

      <details className="panel clips-panel">
        <summary><strong>Review clips</strong><span className="muted">{clips.length} saved · I / O to mark</span></summary>
        <div className="clip-content">
          <form className="controls" onSubmit={saveClip}>
            <button type="button" onClick={() => setIn(time)}>In {inPoint === null ? '· I' : stamp(inPoint, true)}</button>
            <button type="button" onClick={() => setOut(time)}>Out {outPoint === null ? '· O' : stamp(outPoint, true)}</button>
            <input name="title" aria-label="Clip title" placeholder="Clip title" required />
            <input name="note" aria-label="Clip note" placeholder="Optional note" />
            <button type="submit" disabled={inPoint === null || outPoint === null || outPoint <= inPoint}>Save clip</button>
          </form>
          {clips.length > 0 && <ul>{clips.map((clip, i) => <li key={i}><button onClick={() => seek(clip.start_s)}>
            {stamp(clip.start_s)} – {stamp(clip.end_s)}</button><span><strong>{clip.title}</strong>{clip.note && ` · ${clip.note}`}</span></li>)}</ul>}
          {clips.length > 0 && <button onClick={exportClips}>Export clip ranges (JSON)</button>}
        </div>
      </details>
      <footer>RinkView · Local review session <span>{SAMPLE_HZ} Hz tracking data · Time shown from video start</span></footer>
      </div>
    </>
  );
}
