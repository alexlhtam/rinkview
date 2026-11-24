import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import uk from '../../../shared/rink_templates/custom-uk-56x26.json'
import iihf from '../../../shared/rink_templates/iihf.json'
import nhl from '../../../shared/rink_templates/nhl.json'
import allyPally from '../../../shared/rink_templates/ally-pally-estimate.json'
import { TacticsBoard } from '../src'
import type { TeachingClip } from '../src'
import { exampleClip } from './example'
import './demo.css'

const templates = [uk, nhl, iihf, allyPally]
const names = ['UK · 56 × 26 m', 'NHL · 60.96 × 25.908 m', 'IIHF · 60 × 30 m', 'Ally Pally · 56 × 26 m']

function Demo() {
  const [preset, setPreset] = useState(0)
  const [board, setBoard] = useState<{ revision: number; clip?: TeachingClip }>({ revision: 0 })
  function setup(clip?: TeachingClip) {
    setBoard(previous => ({ revision: previous.revision + 1, clip }))
  }

  return <main className="demo-shell">
    <header className="demo-nav">
      <div className="demo-brand">
        <svg aria-hidden="true" viewBox="0 0 38 38" width="38" height="38" fill="none">
          <rect width="38" height="38" rx="10" fill="#73e8ce" />
          <rect x="6" y="10" width="26" height="18" rx="5" stroke="#123e47" strokeWidth="1.8" />
          <path d="M19 10v18M13 11v16m12-16v16" stroke="#123e47" strokeWidth="1.35" />
          <circle cx="19" cy="19" r="3.5" fill="#73e8ce" stroke="#123e47" strokeWidth="1.4" />
        </svg>
        <span>Rink<span>View</span><small>COACHING STUDIO</small></span>
      </div>
      <span className="demo-badge"><i /> Standalone board</span>
    </header>
    <div className="demo-intro">
      <div>
        <h1>Tactics board</h1>
        <p>Draw the play. Show the correction. Take it to the team.</p>
      </div>
      <div className="demo-actions">
        <label>Rink preset <select aria-label="Rink preset" value={preset}
          onChange={event => setPreset(Number(event.target.value))}>
          {names.map((name, index) => <option key={name} value={index}>{name}</option>)}
        </select></label>
        <button onClick={() => setup()}>Blank board</button>
        <button className="demo-example" onClick={() => setup(exampleClip())}>Load example</button>
      </div>
    </div>
    <TacticsBoard key={board.revision} rinkTemplate={templates[preset]} initialClip={board.clip} />
    <footer className="demo-footer"><span>RINKVIEW / COACHING TOOLS</span><span>Centre-ice origin · metres</span></footer>
  </main>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Demo /></StrictMode>)
