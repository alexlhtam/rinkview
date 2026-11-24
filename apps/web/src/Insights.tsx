import { memo, useState } from 'react';
import type { GameData } from './data';
import { HeatmapRink } from './Rink';
import type { PlayingTeam } from './contracts';

const TEAMS: PlayingTeam[] = ['A', 'B'];
const ZONES = [
  ['defensive_s', 'Defensive', 'defensive'],
  ['neutral_s', 'Neutral', 'neutral'],
  ['offensive_s', 'Offensive', 'offensive'],
] as const;

export const Insights = memo(function Insights({ game }: { game: GameData }) {
  const [periodId, setPeriodId] = useState(game.summary.periods[0]?.period);
  const period = game.summary.periods.find(p => p.period === periodId);
  const peak = Math.max(1, ...TEAMS.map(team => period?.heatmaps[team].grid
    .reduce((maximum, row) => row.reduce((m, cell) => Math.max(m, cell), maximum), 0) ?? 0));

  return (
    <div className="insights-grid">
      <section className="panel" aria-labelledby="heatmaps-title">
        <div className="panel-head">
          <div><h2 id="heatmaps-title">Team heatmaps</h2><p>On-ice occupancy · circle marks average position</p></div>
          {period && <select aria-label="Heatmap period" value={periodId} onChange={event => setPeriodId(Number(event.target.value))}>
            {game.summary.periods.map(p => <option key={p.period} value={p.period}>Period {p.period}</option>)}
          </select>}
        </div>
        {period ? <div className="heatmaps">
          {TEAMS.map(team => (
            <div key={team}>
              <div className="heatmap-label"><span><i className={`team-dot team-${team}`} />Team {team}</span>
                <span className="muted">{period.track_counts[team]} tracks</span></div>
              <HeatmapRink rink={game.rink} map={period.heatmaps[team]} team={team} peak={peak} />
            </div>
          ))}
          <div className="heat-key"><span>Low occupancy</span><i /><span>High occupancy</span></div>
        </div> : <p className="empty-panel">No period heatmaps in this summary.</p>}
      </section>
      <section className="panel" aria-labelledby="zones-title">
        <div className="panel-head"><div><h2 id="zones-title">Zone time</h2><p>Share of tracked player time</p></div></div>
        {period ? <div className="zone-content">
          {TEAMS.map(team => {
            const times = period.zone_time[team];
            const total = Object.values(times).reduce((sum, value) => sum + value, 0);
            return (
              <div className="zone-team" key={team}>
                <div className="heatmap-label"><span><i className={`team-dot team-${team}`} />Team {team}</span>
                  <span className="muted">{total.toFixed(1)} player-s</span></div>
                <div className="zone-bar" role="img" aria-label={ZONES.map(([key, name]) => `${name}: ${times[key].toFixed(1)} player-seconds`).join(', ')}>
                  {ZONES.map(([key, name, style]) => <span key={key} className={style}
                    title={`${name}: ${times[key].toFixed(1)} player-s`} style={{ flexBasis: `${total ? 100 * times[key] / total : 0}%` }} />)}
                </div>
              </div>
            );
          })}
          <div className="zone-key">{ZONES.map(([, name, style]) => <span key={style}><i className={style} />{name}</span>)}</div>
        </div> : <p className="empty-panel">No zone totals in this summary.</p>}
      </section>
    </div>
  );
});
