import { useEffect, useReducer, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { TacticsBoard, createClip } from '@rinkview/tactics-board/source';
import type { TeachingClip } from '@rinkview/tactics-board/source';
import allyPally from '../../../shared/rink_templates/ally-pally-estimate.json';
import custom from '../../../shared/rink_templates/custom-uk-56x26.json';
import iihf from '../../../shared/rink_templates/iihf.json';
import nhl from '../../../shared/rink_templates/nhl.json';
import p1 from '../../../shared/calibrations/ally-pally-side-p1.json';
import p2 from '../../../shared/calibrations/ally-pally-side-p2.json';
import p3 from '../../../shared/calibrations/ally-pally-side-p3.json';
import type { Role, Team } from './contracts';
import { TEAM_COLORS, rinkGeometry } from './rinkGeometry';
import { fitCalibration, imageToRink, rinkLandmarks, rinkPaths, rinkToImage } from './screenshotCalibration';
import type { LandmarkPair, Point, ScreenshotCalibration } from './screenshotCalibration';
import { editMarkers } from './screenshotMarkers';
import type { Marker } from './screenshotMarkers';

const templates = { [allyPally.id]: allyPally, [custom.id]: custom, [iihf.id]: iihf, [nhl.id]: nhl };
function readCalibration(value: unknown): ScreenshotCalibration {
  const config = value as ScreenshotCalibration | null;
  const point = (input: unknown) => Array.isArray(input) && input.length === 2 && input.every(Number.isFinite);
  if (!config || typeof config.id !== 'string' || typeof config.rink_template !== 'string'
    || !point(config.image_size) || !Array.isArray(config.homography) || config.homography.length !== 3
    || !config.homography.every(row => Array.isArray(row) && row.length === 3 && row.every(Number.isFinite))
    || (config.radial_correction && (!point(config.radial_correction.centre_px)
      || !Number.isFinite(config.radial_correction.scale_px) || config.radial_correction.scale_px <= 0
      || !Number.isFinite(config.radial_correction.k) || config.radial_correction.k < 0))
    || (config.point_pairs && (!Array.isArray(config.point_pairs)
      || !config.point_pairs.every(pair => pair && typeof pair.landmark_id === 'string' && point(pair.image_px) && point(pair.rink_m))))
    || (config.ice_mask_polygon && (!Array.isArray(config.ice_mask_polygon) || config.ice_mask_polygon.length < 3
      || !config.ice_mask_polygon.every(point)))
    || (config.reprojection_rms_m !== undefined && !Number.isFinite(config.reprojection_rms_m))) {
    throw new Error('Invalid screenshot calibration JSON.');
  }
  return config;
}

const saved = [p1, p2, p3].map(readCalibration);
const teams = ['A', 'B', 'none'] as const;
type Picture = { file: File; url: string; size: Point };
type Detection = { foot_px: Point; bbox: Marker['bbox']; role: Role; team: Team; x_m?: number; y_m?: number };

function label(id: string) { return id.replaceAll('_', ' '); }
function matching(calibration: ScreenshotCalibration, [w, h]: Point) {
  return calibration.image_size[0] === w && calibration.image_size[1] === h;
}

function saveCalibration(calibration: ScreenshotCalibration) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(calibration, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${calibration.id}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Screenshot({ active }: { active: boolean }) {
  const [picture, setPicture] = useState<Picture>();
  const [template, setTemplate] = useState(allyPally.id);
  const [calibration, setCalibration] = useState<ScreenshotCalibration>();
  const [pairs, setPairs] = useState<LandmarkPair[]>([]);
  const [landmark, setLandmark] = useState('');
  const [iceOutline, setIceOutline] = useState<Point[] | null>(null);
  const [markers, dispatch] = useReducer(editMarkers, []);
  const [selected, setSelected] = useState('');
  const [add, setAdd] = useState(false);
  const [board, setBoard] = useState<TeachingClip>();
  const [boardOpen, setBoardOpen] = useState(false);
  const [includeThumbnail, setIncludeThumbnail] = useState(false);
  const [names, setNames] = useState({ A: 'Team A', B: 'Team B', none: 'Unassigned' });
  const [colors, setColors] = useState(TEAM_COLORS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [detectedAt, setDetectedAt] = useState<ScreenshotCalibration>();
  const request = useRef(0);
  const drag = useRef<string | null>(null);
  const rink = templates[template];
  const geometry = rinkGeometry(rink);
  const options = rinkLandmarks(rink);
  const paths = rinkPaths(rink);
  const choice = markers.find(marker => marker.id === selected);
  const compatible = picture ? saved.filter(config => matching(config, picture.size)) : [];
  const projected = markers.flatMap(marker => {
    if (!calibration) return [];
    try {
      if (marker.rink && calibration === detectedAt) {
        const [x, y] = marker.rink;
        return [{ marker, x, y, inRink: true }];
      }
      const [x, y] = imageToRink(marker.foot, calibration);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
      return [{ marker, x, y, inRink: Math.abs(y) <= geometry.boardY(x) && Math.abs(x) <= geometry.x }];
    } catch { return []; }
  });

  useEffect(() => () => { if (picture) URL.revokeObjectURL(picture.url); }, [picture]);

  useEffect(() => {
    if (!active) return;
    function paste(event: ClipboardEvent) {
      const image = Array.from(event.clipboardData?.files ?? []).find(file => file.type.startsWith('image/'));
      if (image) { event.preventDefault(); void openPicture(image); }
    }
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [active]);

  async function openPicture(file: File) {
    const ticket = ++request.current;
    const url = URL.createObjectURL(file);
    try {
      const preview = new Image();
      preview.src = url;
      await preview.decode();
      if (ticket !== request.current) { URL.revokeObjectURL(url); return; }
      setPicture({ file, url, size: [preview.naturalWidth, preview.naturalHeight] });
      setCalibration(undefined);
      setPairs([]);
      setLandmark('');
      setIceOutline(null);
      setSelected('');
      setAdd(false);
      setBoard(undefined);
      setBoardOpen(false);
      dispatch({ type: 'replace', markers: [] });
      setBusy(false);
      setError('');
    } catch {
      URL.revokeObjectURL(url);
      if (ticket === request.current) { setBusy(false); setError('Could not open this image. Choose a PNG or JPEG.'); }
    }
  }

  function selectCalibration(next: ScreenshotCalibration) {
    if (!picture || !matching(next, picture.size)) throw new Error('Calibration does not match the image resolution.');
    const id = next.rink_template.split(/[\\/]/).at(-1)?.replace(/\.json$/, '');
    if (!id || !Object.hasOwn(templates, id)) throw new Error('This calibration must reference a bundled rink template.');
    rinkToImage([0, 0], next);
    setCalibration(next);
    setTemplate(id);
    setPairs(next.point_pairs ?? []);
    setLandmark('');
    setIceOutline(null);
    setError('');
  }

  function pointerPoint(event: PointerEvent<SVGSVGElement>): Point {
    const matrix = event.currentTarget.getScreenCTM();
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix?.inverse());
    return [Math.max(0, Math.min(picture!.size[0], point.x)), Math.max(0, Math.min(picture!.size[1], point.y))];
  }

  function onImageDown(event: PointerEvent<SVGSVGElement>) {
    const point = pointerPoint(event);
    if (iceOutline) {
      setIceOutline([...iceOutline, point]);
    } else if (landmark) {
      const next = [...pairs.filter(pair => pair.landmark_id !== landmark),
        { landmark_id: landmark, image_px: point, rink_m: options[landmark] }];
      setPairs(next);
      setLandmark('');
      setError('');
    } else if (add) {
      const id = crypto.randomUUID();
      dispatch({ type: 'add', marker: { id, foot: point, team: 'none', role: 'player' } });
      setSelected(id);
      setAdd(false);
    } else {
      const id = (event.target as Element).closest('[data-marker]')?.getAttribute('data-marker') ?? '';
      setSelected(id);
      if (id) {
        drag.current = id;
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    }
  }

  async function analyze() {
    if (!picture || !calibration) return;
    const ticket = ++request.current;
    setBusy(true);
    setError('');
    try {
      const data = new FormData();
      data.set('image', picture.file);
      data.set('calibration', JSON.stringify(calibration));
      data.set('rink', JSON.stringify(rink));
      const response = await fetch('/api/analyze', { method: 'POST', headers: { 'X-RinkView-Client': 'web' }, body: data });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.detail === 'string' ? body.detail : 'Could not analyze screenshot. Check that rinkview serve is running.');
      }
      const result: { detections: Detection[] } = await response.json();
      if (ticket !== request.current) return;
      dispatch({ type: 'replace', markers: result.detections.map(d => ({
        id: crypto.randomUUID(), foot: d.foot_px, bbox: d.bbox, team: d.team, role: d.role,
        rink: d.x_m !== undefined && d.y_m !== undefined ? [d.x_m, d.y_m] : undefined,
      })) });
      setDetectedAt(calibration);
      setSelected('');
    } catch (cause) {
      if (ticket === request.current) setError(cause instanceof Error ? cause.message : 'Screenshot analysis failed.');
    } finally {
      if (ticket === request.current) setBusy(false);
    }
  }

  async function sendToBoard() {
    if (!picture) return;
    let thumbnail: string | undefined;
    if (includeThumbnail) {
      const image = new Image();
      image.src = picture.url;
      try {
        await image.decode();
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 240 / Math.max(...picture.size));
        [canvas.width, canvas.height] = picture.size.map(value => Math.max(1, Math.round(value * scale)));
        canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
        thumbnail = canvas.toDataURL('image/jpeg', .8);
      } catch {
        setError('Could not embed a thumbnail. Retry without the thumbnail.');
        return;
      }
    }
    setBoard({
      ...createClip(), title: picture.file.name, screenshot: {
        filename: picture.file.name, thumbnail,
      },
      added_players_json: projected.filter(p => p.inRink).map(({ marker, x, y }) => ({
        id: marker.id, x_m: x, y_m: y, team: marker.team, role: marker.role,
      })),
    });
    setBoardOpen(true);
  }

  const markerColor = (marker: Marker) => colors[marker.role === 'referee' ? 'none' : marker.team];
  const overlay = calibration ? paths.flatMap(path => {
    try { return [{ ...path, points: path.points.map(point => rinkToImage(point, calibration)) }]; }
    catch { return []; }
  }) : [];

  return <div hidden={!active}>
    {board && boardOpen ? <section className="teaching-panel">
      <div className="panel-head"><div><h2>Screenshot whiteboard</h2><p>{board.screenshot?.filename}</p></div>
        <button onClick={() => setBoardOpen(false)}>Back to screenshot</button></div>
      <TacticsBoard rinkTemplate={rink} initialClip={board} onChange={setBoard} teamColors={colors} teamNames={names} />
    </section> : <section className="workspace screenshot" onDragOver={event => event.preventDefault()} onDrop={event => {
      event.preventDefault();
      if (event.dataTransfer.files[0]) void openPicture(event.dataTransfer.files[0]);
    }}>
      <div className="panel-head"><div><h2>1 · Open a screenshot</h2><p>Drop, paste or choose an image. Files stay on this computer.</p></div>
        <input aria-label="Screenshot image" type="file" accept="image/*" onChange={event => {
          if (event.target.files?.[0]) void openPicture(event.target.files[0]);
        }} /></div>
      {picture && <>
        <div className="screenshot-tools">
          <h2>2 · Calibrate the rink</h2>
          <p>{picture.file.name} · {picture.size.join(' × ')} px. Use a saved calibration only for the same camera view.</p>
          <div className="controls">
            <label>Saved calibration <select value={compatible.some(cfg => cfg.id === calibration?.id) ? calibration?.id : ''}
              onChange={event => {
                const next = compatible.find(cfg => cfg.id === event.target.value);
                if (next) selectCalibration(next);
              }}>
              <option value="">{compatible.length ? 'Suggested by resolution' : 'No matching bundled calibration'}</option>
              {compatible.map(cfg => <option key={cfg.id}>{cfg.id}</option>)}
            </select></label>
            <label>Calibration JSON <input aria-label="Screenshot calibration JSON" type="file" accept=".json,application/json"
              onChange={async event => {
                const file = event.target.files?.[0];
                if (!file) return;
                try { selectCalibration(readCalibration(JSON.parse(await file.text()))); }
                catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid calibration.'); }
              }} /></label>
            <label>Rink template <select value={template} onChange={event => {
              setTemplate(event.target.value); setCalibration(undefined); setPairs([]); setLandmark(''); setIceOutline(null);
              setBoard(undefined);
            }}>{Object.keys(templates).map(id => <option key={id}>{id}</option>)}</select></label>
          </div>
          <div className="controls">
            <label>Next landmark <select value={landmark} onChange={event => { setLandmark(event.target.value); setAdd(false); setIceOutline(null); }}>
              <option value="">Select a rink landmark</option>
              {Object.keys(options).map(id => <option key={id} value={id}>{label(id)}</option>)}
            </select></label>
            <button disabled={!pairs.length} onClick={() => setPairs(pairs.slice(0, -1))}>Remove last landmark</button>
            <button disabled={pairs.length < 4} onClick={() => {
              try {
                const config = fitCalibration(pairs, picture.size, `../rink_templates/${template}.json`);
                setCalibration({ ...config, ice_mask_polygon: calibration?.ice_mask_polygon });
                setError('');
              }
              catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not fit calibration.'); }
            }}>Fit {pairs.length} landmarks</button>
            <button disabled={!calibration} onClick={() => calibration && saveCalibration(calibration)}>Download calibration</button>
            {calibration?.reprojection_rms_m !== undefined && <span role="status">Reprojection RMS {calibration.reprojection_rms_m.toFixed(3)} m</span>}
          </div>
          {calibration && <div className="controls">
            <button onClick={() => { setIceOutline(iceOutline ? null : []); setLandmark(''); setAdd(false); }}>
              {iceOutline ? 'Cancel ice outline' : 'Trace visible ice'}
            </button>
            {iceOutline && <button disabled={iceOutline.length < 3} onClick={() => {
              setCalibration({ ...calibration, ice_mask_polygon: iceOutline });
              setIceOutline(null);
            }}>Use ice outline</button>}
          </div>}
          <p>{iceOutline ? 'Click around the visible ice in order, excluding spectators and benches, then use the outline.'
            : landmark ? `Click the ${label(landmark)} on the screenshot.`
              : 'Spread four or more named landmarks across the ice. If the projection includes spectators, trace the visible ice before analyzing.'}</p>
        </div>
        <div className="stage-grid">
          <div className="stage"><h2>Screenshot</h2>
            <svg aria-label="Screenshot with marker editor" className="screenshot-editor" viewBox={`0 0 ${picture.size.join(' ')}`}
              onPointerDown={onImageDown} onPointerMove={event => {
                if (drag.current) dispatch({ type: 'edit', id: drag.current, patch: { foot: pointerPoint(event), bbox: undefined, rink: undefined } });
              }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
              <image href={picture.url} width={picture.size[0]} height={picture.size[1]} />
              {calibration?.ice_mask_polygon && <defs><clipPath id="visible-ice">
                <polygon points={calibration.ice_mask_polygon.map(p => p.join(',')).join(' ')} />
              </clipPath></defs>}
              <g clipPath={calibration?.ice_mask_polygon ? 'url(#visible-ice)' : undefined}>
              {overlay.map((path, i) => <polyline key={i} points={path.points.map(p => p.join(',')).join(' ')} stroke={path.color}
                fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
              </g>
              {iceOutline ? <polyline points={iceOutline.map(p => p.join(',')).join(' ')} stroke="#ffdb70"
                fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                : calibration?.ice_mask_polygon && <polygon points={calibration.ice_mask_polygon.map(p => p.join(',')).join(' ')}
                  stroke="#70e4d0" fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
              {pairs.map((pair, i) => <g key={pair.landmark_id} pointerEvents="none">
                <circle cx={pair.image_px[0]} cy={pair.image_px[1]} r={picture.size[0] / 195} fill="#ffdb70" />
                <text x={pair.image_px[0] + picture.size[0] / 150} y={pair.image_px[1]} fill="#ffdb70"
                  fontSize={picture.size[0] / 60}>{i + 1}</text>
              </g>)}
              {markers.map(marker => <g key={marker.id} data-marker={marker.id}>
                {marker.bbox && <rect x={marker.bbox[0]} y={marker.bbox[1]} width={marker.bbox[2] - marker.bbox[0]}
                  height={marker.bbox[3] - marker.bbox[1]} fill="transparent" stroke={markerColor(marker)} vectorEffect="non-scaling-stroke" />}
                <circle cx={marker.foot[0]} cy={marker.foot[1]} r={picture.size[0] / 135} fill={markerColor(marker)}
                  stroke={marker.id === selected ? '#ffff70' : 'white'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
              </g>)}
            </svg>
          </div>
          <div className="stage"><h2>2D rink</h2>
            <svg aria-label="Projected rink markers" className="screenshot-rink"
              viewBox={`${-geometry.x - 2} ${-geometry.y - 2} ${geometry.paddedWidth + 1} ${geometry.paddedHeight + 1}`}>
              {paths.map((path, i) => <polyline key={i} points={path.points.map(([x, y]) => `${x},${-y}`).join(' ')}
                fill={i ? 'none' : '#eef5ff'} stroke={path.color} strokeWidth={i ? .18 : .26} />)}
              {projected.filter(p => p.inRink).map(({ marker, x, y }) => <circle key={marker.id} cx={x} cy={-y} r=".6"
                fill={markerColor(marker)} stroke={marker.id === selected ? '#e3a400' : 'white'} strokeWidth=".15"
                onClick={() => setSelected(marker.id)} />)}
            </svg>
          </div>
        </div>
        <div className="screenshot-tools">
          <h2>3 · Review and send to the whiteboard</h2>
          <div className="controls">
            <button disabled={!calibration || busy} onClick={() => void analyze()}>{busy ? 'Analyzing…' : 'Analyze screenshot'}</button>
            <button aria-pressed={add} onClick={() => { setAdd(!add); setLandmark(''); setIceOutline(null); }}>Add marker</button>
            <label>Marker <select value={selected} onChange={event => setSelected(event.target.value)}>
              <option value="">Select a marker</option>{markers.map((marker, i) =>
                <option key={marker.id} value={marker.id}>{i + 1} · {marker.role} · {names[marker.team]}</option>)}
            </select></label>
            {choice && <>
              <label>Team <select value={choice.team} onChange={event =>
                dispatch({ type: 'edit', id: choice.id, patch: { team: event.target.value as Team } })}>
                {teams.map(team => <option key={team} value={team}>{names[team]}</option>)}
              </select></label>
              <label>Role <select value={choice.role} onChange={event =>
                dispatch({ type: 'edit', id: choice.id, patch: { role: event.target.value as Role } })}>
                <option>player</option><option>goalie</option><option>referee</option>
              </select></label>
              <button onClick={() => { dispatch({ type: 'delete', id: choice.id }); setSelected(''); }}>Delete marker</button>
            </>}
            <label><input type="checkbox" checked={includeThumbnail} onChange={event => setIncludeThumbnail(event.target.checked)} /> Include thumbnail</label>
            <button className="primary" disabled={!projected.some(p => p.inRink)} onClick={() => void sendToBoard()}>Send to whiteboard</button>
            {board && <button onClick={() => setBoardOpen(true)}>Reopen whiteboard draft</button>}
          </div>
          <p>{add ? 'Click the skate point in the screenshot.' : `${markers.length} markers · ${projected.filter(p => p.inRink).length} on the rink. Drag markers on the screenshot to correct them.`}</p>
          <div className="controls">{(['A', 'B'] as const).map(team => <label key={team}>Team {team}
            <input aria-label={`Team ${team} name`} value={names[team]} onChange={event => setNames({ ...names, [team]: event.target.value })} />
            <input aria-label={`Team ${team} color`} type="color" value={colors[team]} onChange={event => setColors({ ...colors, [team]: event.target.value })} />
          </label>)}</div>
        </div>
      </>}
      {error && <p role="alert" className="screenshot-error">{error}</p>}
    </section>}
  </div>;
}
