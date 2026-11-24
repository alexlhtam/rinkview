import { StrictMode, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { loadLocalGame } from './data';
import type { GameData } from './data';
import { Viewer } from './Viewer';
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
  { id: 'video', name: 'Match video', accept: 'video/*,.mkv', hint: 'MP4 recommended' },
  { id: 'positions', name: 'Positions JSON', accept: '.json,application/json', hint: '10 Hz tracking samples' },
  { id: 'summary', name: 'Summary JSON', accept: '.json,application/json', hint: 'Period analytics' },
  { id: 'rink', name: 'Rink template', accept: '.json,application/json', hint: 'Metre-based geometry' },
] as const;

function App() {
  const [game, setGame] = useState<GameData | null>(null);
  const [showFiles, setShowFiles] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => () => game?.dispose(), [game]);

  async function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const [video, positions, summary, rink] = INPUTS.map(({ id }) => form.get(id));
    if (!([video, positions, summary, rink].every(file => file instanceof File && file.size > 0))) {
      setError('Choose all four non-empty files.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const next = await loadLocalGame({ video: video as File, positions: positions as File, summary: summary as File, rink: rink as File });
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
          <div className="panel-head"><div><h2 id="files-title">Open a local game</h2><p>Files stay on this device and are never uploaded.</p></div></div>
          <form onSubmit={load}>
            <div className="file-grid">{INPUTS.map(input =>
              <label key={input.id}><strong>{input.name}</strong><span>{input.hint}</span>
                <input type="file" name={input.id} accept={input.accept} required />
              </label>)}</div>
            <div className="load-footer"><button type="submit" className="primary" disabled={loading}>
              {loading ? 'Loading…' : 'Open game'}</button>{error && <p role="alert">{error}</p>}</div>
          </form>
        </section>}
        {game && <Viewer game={game} key={game.videoUrl} />}
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
