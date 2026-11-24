# RinkView Game Viewer

See the [repo quickstart](../../README.md#run-the-game-viewer) to load a
local game. The file adapter in `src/data.ts` validates the shared JSON
contracts and exposes time-window reads; a future API adapter can use the
same interface. The local JSON is indexed in memory; the viewer requests
60-second windows with trail overlap and preloads the next window.

```sh
npm run lint
npm run test
npm run typecheck
npm run build
```

The prototype does not upload or process a game, calibrate cameras, or
include tactics-board tools. The shared positions schema has no video
bounding boxes, so selecting a dot highlights it on the rink only. The
summary provides period analytics but not period boundary timestamps, so
the timeline does not infer boundaries for multi-period files.
