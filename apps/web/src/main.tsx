import { StrictMode, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { loadReplacementGame } from './data';
import type { GameData } from './data';
import { Viewer } from './Viewer';
import type { ViewerHandle } from './Viewer';
import { Screenshot } from './Screenshot';
import './style.css';

function Brand() {
  return <div className="brand">
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <rect width="34" height="34" rx="9" fill="#6fe4d0" />
      <rect x="5.5" y="9.5" width="23" height="15" rx="6" fill="none" stroke="#0e2a34" strokeWidth="1.5" />
      <path d="M17 9.5v15M11 11v12m12-12v12" fill="none" stroke="#0e2a34" strokeWidth="1.25" />
      <circle cx="17" cy="17" r="3" fill="#6fe4d0" stroke="#0e2a34" strokeWidth="1.25" />
    </svg>
    <span>RinkView<small>COACHING WORKSPACE</small></span>
  </div>;
}

const INPUTS = [
  { id: 'video', name: 'Match video', accept: 'video/*,.mkv', hint: 'Original clip or a time-aligned MP4 copy', required: true },
  { id: 'calibration', name: 'Camera calibration', accept: '.json,application/json', hint: 'Select the calibration used by the pipeline' },
  { id: 'positions', name: 'Positions JSON', accept: '.json,application/json', hint: 'Alternative to the output folder' },
  { id: 'summary', name: 'Summary JSON', accept: '.json,application/json', hint: 'Alternative to the output folder' },
  { id: 'rink', name: 'Rink template override', accept: '.json,application/json', hint: 'Use if the calibration’s template is unavailable' },
] as const;

function App() {
  const [mode, setMode] = useState<'screenshot' | 'video'>('screenshot');
  const [game, setGame] = useState<GameData | null>(null);
  const [showFiles, setShowFiles] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const viewer = useRef<ViewerHandle>(null);

  useEffect(() => () => game?.dispose(), [game]);

  async function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const picked = (value: FormDataEntryValue | null): value is File => value instanceof File && value.name !== '';
    const file = (name: string) => {
      const value = form.get(name);
      return picked(value) ? value : undefined;
    };
    const video = file('video');
    if (!video || !video.size) {
      setError('Choose a non-empty match video.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const next = await loadReplacementGame(
        { video, positions: file('positions'), summary: file('summary'),
          rink: file('rink'), calibration: file('calibration'), folder: form.getAll('folder').filter(picked) },
        () => viewer.current?.confirmDiscardDraft() ?? true,
      );
      if (!next) return;
      setGame(next);
      setShowFiles(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the selected files.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <header className="topbar"><div className="shell topbar-inner">
        <Brand />
        <div className="session-status micro"><i /> LOCAL SESSION</div>
      </div></header>
      <main className="shell">
        <nav className="controls mode-switch" aria-label="Coaching workspace mode">
          <button aria-pressed={mode === 'screenshot'} onClick={() => setMode('screenshot')}>Screenshot</button>
          <button aria-pressed={mode === 'video'} onClick={() => setMode('video')}>Video add-on</button>
        </nav>
        {mode === 'screenshot' && <div className="page-heading">
          <div className="eyebrow"><span /> COACHING WHITEBOARD</div>
          <h1>Screenshot review</h1>
          <p>Map the skaters from a still image, correct their positions, and open your coaching whiteboard.</p>
        </div>}
        <Screenshot active={mode === 'screenshot'} />
        <div hidden={mode !== 'video'}>
        <div className="page-heading flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="eyebrow"><span /> REVIEW DESK</div>
            <h1>Game Viewer</h1>
            <p>{game ? <><strong>{game.videoName}</strong><span className="separator"> / </span>{game.rink.id}</>
              : 'Review match footage and tracked player movement on a shared timeline.'}</p>
          </div>
          {game && <button onClick={() => setShowFiles(current => !current)} aria-expanded={showFiles}>
            {showFiles ? 'Close files' : 'Change files'}
          </button>}
        </div>
        {showFiles && <section className="panel load-panel" aria-labelledby="files-title">
          <div className="panel-head"><div><h2 id="files-title">Open a local game</h2>
            <p>Files stay on this device. Without a calibration or override, the viewer uses the Alexandra Palace sample rink.</p></div></div>
          <form onSubmit={load}>
            <div className="file-grid">
              <label><strong>Pipeline output folder</strong><span>Folder containing positions.json and summary.json</span>
                <input type="file" name="folder" multiple {...{ webkitdirectory: '' }} />
              </label>
              {INPUTS.map(input =>
              <label key={input.id}><strong>{input.name}</strong><span>{input.hint}</span>
                <input type="file" name={input.id} accept={input.accept} required={input.id === 'video'} />
              </label>)}</div>
            <div className="load-footer"><button type="submit" className="primary" disabled={loading}>
              {loading ? 'Loading…' : 'Open game'}</button>{error && <p role="alert">{error}</p>}</div>
          </form>
        </section>}
        {game && <Viewer ref={viewer} game={game} key={game.videoUrl} />}
        </div>
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
