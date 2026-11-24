# RinkView Game Viewer

See the [repo quickstart](../../README.md#run-the-game-viewer) to load a
local game. The file adapter in `src/data.ts` validates the shared JSON
contracts and exposes time-window reads; a future API adapter can use the
same interface. The local JSON is indexed in memory; the viewer requests
60-second windows with trail overlap and preloads the next window.

Run checks for both JavaScript workspaces from the repo root:

```sh
npm ci
npm run lint
npm run test
npm run typecheck
npm run build
```

The viewer can load real pipeline exports and open the tactics board at a
frozen frame; it does not upload or process a game or calibrate cameras. The shared positions schema has no video
bounding boxes, so selecting a dot highlights it on the rink only. The
summary provides period analytics but not period boundary timestamps, so
the timeline does not infer boundaries for multi-period files.
