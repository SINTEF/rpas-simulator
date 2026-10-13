# viz/ — the swarm view

The three.js "architect's model" swarm view, the only
view. Everything UI lives here and nowhere else. It renders the **sim bus** (truth)
and commands through the **swarm bus**; it holds no authoritative state.

```bash
python3 viz/serve.py                            # http://localhost:8000, proxies /api to SEN REST :8080
SEN_REST=http://localhost:8090 python3 viz/serve.py   # a stack started with REST_PORT=8090
```

Open http://localhost:8000/. The web container bakes a copy of
`viz/`, so after edits run `docker compose up -d --build web` and hard-refresh once.
`?fps` shows a frame counter (and the GPU string). URL hash presets: `#far` (the theatre,
default), `#mid`, `#near`, `#base`, a unit id (`#cluster:<id>`, `#vehicle:<name>`) or `#drone:<id>`.

Fleet on the left, inspector on the right, command dock at the bottom, distance
strip, edge tabs for anything off screen. The fleet rows and the inspector show the published
state (motion from `truth_drone<ID>`, mode and battery from `drone<ID>`) and the navigator status;
the map is truth. Layers: **Min size** (the minimum on-screen size rule; off = true scale),
**Airspace**, **Range rings**, **Mock-up data**.

| File | What it does |
|---|---|
| `serve.py` | Static server + same-origin `/api` reverse proxy to SEN REST (avoids CORS and SEN's REST/TCP-segment issue); `/spawn`, `/kill`, `/reset` (an ordered restart to `scenarios/initial.yaml`, compose stack only). |
| `sen_client.js` | REST + SSE client: auth, interests, property subscriptions, method invokes. One client id per page — a re-auth with the same id kills the other session. |
| `index.html`, `swarm.css` | Page shell and styles. |
| `app/` | `model/` pure, `scene/` three.js, `hud/`, `ui/` Preact + htm, `sen/` feed + commands. |
| `vendor/` | three, Preact, htm and fonts (`vendor/VENDOR.md`); no npm, no bundler, an import map. |
| `data/<area>/` | Committed theatre DEM + OSM land cover. `data/index.json` must always exist. |
| `fetch_area_assets.py` | One-shot fetch of a new area's theatre DEM and land cover. |
| `test/` | `node --test viz/test`. |

Terrain is the committed theatre DEM + OSM land cover in `data/`. For another area, change the
`origin:` in `config/world.yaml`, then run
`python3 viz/fetch_area_assets.py config/world.yaml --name <area> --theatre-km 60x40` (needs
numpy/PyYAML/Pillow). It downloads Copernicus GLO-30 DEM tiles and OSM land cover once, writes
`viz/data/<area>/` and updates `viz/data/index.json`.

**No API keys, no accounts**, and no request leaves the origin: everything is vendored or committed.

SEN rules: one REST client id per page, interests `SELECT * FROM sim.bus` and
`SELECT * FROM swarm.bus`, every drone command a call on the drone's own object on `swarm.bus` (`drone<ID>`, `waypoint_navigator_drone<ID>`), Spawn / Remove through `serve.py`
(`/spawn`, `/kill`, `/reset`). Caveat: several viewers open + Remove, or participants rejoining a running
world, have crashed `world` (`patches/sen/upstream-core-property-connection-remove-segfault.md`).

**The flat sim over a bumpy map**: the simulation's ground is the
origin's altitude, so a flying thing is drawn at `groundH + altitude` and a
ground thing is clamped to the DEM under it. A drone flying low over a hill the
sim does not model is inside that hill. Do not fudge this in the renderer —
sim-side terrain following comes later.

All of `viz/` is `.dockerignore`d out of the sim image; `web` has its own context.
