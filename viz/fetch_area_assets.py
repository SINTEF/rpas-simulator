#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""One-shot fetch of the theatre's terrain + land cover for the origin.

    python3 viz/fetch_area_assets.py config/world.yaml --name oslo --theatre-km 60x40

Downloads, for the world config's `origin:` (latitude/longitude), over a
W x H km theatre centred on it (--theatre-km, default 60x40):
  (a) `dem_theatre.bin`: a DEM resampled onto one regular lat/lon grid
      (--spacing-m, default 30), int16 metres (little-endian, row-major,
      row 0 = north). Source: Copernicus GLO-30 DSM from the public AWS
      open-data bucket (no auth; 1°x1° GeoTIFF tiles that PIL can decode).
  (b) `landcover.png` on that grid: one 8-bit greyscale pixel per DEM sample,
      value = class index (0 open, 1 forest, 2 farmland, 3 water; the table
      is `theatre.landcover.classes` in dem.json). Forest (landuse=forest,
      natural=wood), farmland (landuse=farmland|meadow) and water
      (natural=water, landuse=reservoir) come from OSM via tiled Overpass
      queries (sequential, paused, cached), rasterised with PIL; water wins
      over forest over farmland. Sea = DEM <= 1 m (the fjord has no OSM
      polygon, only a coastline).

Output: viz/data/<name>/{dem_theatre.bin,landcover.png,dem.json} (dem.json =
the sidecar: origin, source, license, `theatre` grid bounds), and the area is
added to viz/data/index.json (the committed index the UI reads — a fetch for
a missing file would log a browser console error, so the index must always
exist). Re-runs are idempotent: same inputs produce the same outputs,
downloads are cached under ~/.cache/drone_sim_area_assets/.

The DEM's orthometric heights are used directly as heights above the
ellipsoid (the project's AMSL-as-ellipsoid convention).
"""

import argparse
import io
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import numpy as np
import yaml
from PIL import Image, ImageDraw

DEM_BUCKET = "https://copernicus-dem-30m.s3.amazonaws.com"
DEM_SOURCE = "Copernicus GLO-30 DSM (AWS open data)"
DEM_LICENSE = ("Free to use under the Copernicus DEM licence: "
               "(c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH "
               "2014-2018 provided under COPERNICUS by the European Union and "
               "ESA; all rights reserved")
DEM_ATTRIBUTION = "Terrain: Copernicus GLO-30 DSM (ESA)"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OSM_SOURCE = "OpenStreetMap via Overpass API"
OSM_LICENSE = "ODbL 1.0, (c) OpenStreetMap contributors"
CACHE_DIR = os.path.expanduser("~/.cache/drone_sim_area_assets")
M_PER_DEG_LAT = 111320.0  # project's flat-earth convention (see common/geo.h)


def find_origin(node):
    """First `origin:` mapping with latitude/longitude anywhere in the sen run
    YAML (config/world.yaml nests it under build[].objects[] as a struct static)."""
    if isinstance(node, dict):
        o = node.get("origin")
        if isinstance(o, dict) and "latitude" in o and "longitude" in o:
            return float(o["latitude"]), float(o["longitude"])
        for v in node.values():
            found = find_origin(v)
            if found:
                return found
    elif isinstance(node, list):
        for v in node:
            found = find_origin(v)
            if found:
                return found
    return None


def fetch_cached(url, cache_name, data=None):
    """GET/POST url, caching the response body on disk (idempotent re-runs).
    Overpass throttles with 429/504: wait and retry a few times."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, cache_name)
    if os.path.exists(path):
        with open(path, "rb") as f:
            return f.read()
    req = urllib.request.Request(url, data=data,
                                 headers={"User-Agent": "drone_sim_v4 fetch_area_assets"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                body = r.read()
            break
        except urllib.error.HTTPError as e:
            if e.code not in (429, 504) or attempt == 4:
                raise
            print(f"  HTTP {e.code}, retrying in {30 * (attempt + 1)} s")
            time.sleep(30 * (attempt + 1))
    with open(path, "wb") as f:
        f.write(body)
    return body


# --- DEM ---

def dem_tile(lat_deg, lon_deg):
    """Load one 1°x1° GLO-30 tile as a float32 array, or None if it doesn't
    exist (sea-only tiles are not published — treated as height 0)."""
    ns = "N" if lat_deg >= 0 else "S"
    ew = "E" if lon_deg >= 0 else "W"
    stem = (f"Copernicus_DSM_COG_10_{ns}{abs(lat_deg):02d}_00_"
            f"{ew}{abs(lon_deg):03d}_00_DEM")
    try:
        body = fetch_cached(f"{DEM_BUCKET}/{stem}/{stem}.tif", f"{stem}.tif")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print(f"  {stem}: no tile (sea) -> 0 m")
            return None
        raise
    arr = np.array(Image.open(io.BytesIO(body)), dtype=np.float32)
    print(f"  {stem}: {arr.shape[1]}x{arr.shape[0]}, "
          f"{arr.min():.0f}..{arr.max():.0f} m")
    return arr


def sample_dem(lats, lons):
    """Bilinear-sample GLO-30 at the given 1-D lat/lon grids (degrees).
    Returns a (len(lats), len(lons)) float array. Tile pixel centers sit at
    lat = k+1 - row/3600, lon = m + col/ncols (top-left center exactly at the
    tile's NW integer corner); sampling clamps at tile edges, so seams carry
    up to one pixel of error — irrelevant at scenery scale."""
    out = np.zeros((len(lats), len(lons)), dtype=np.float32)
    for tlat in range(math.floor(lats.min()), math.floor(lats.max()) + 1):
        rows = np.nonzero((lats >= tlat) & (lats < tlat + 1))[0]
        if len(rows) == 0:
            continue
        for tlon in range(math.floor(lons.min()), math.floor(lons.max()) + 1):
            cols = np.nonzero((lons >= tlon) & (lons < tlon + 1))[0]
            if len(cols) == 0:
                continue
            tile = dem_tile(tlat, tlon)
            if tile is None:
                continue
            nrow, ncol = tile.shape
            r = np.clip((tlat + 1 - lats[rows]) * nrow, 0, nrow - 1)
            c = np.clip((lons[cols] - tlon) * ncol, 0, ncol - 1)
            r0 = np.clip(np.floor(r).astype(int), 0, nrow - 2)
            c0 = np.clip(np.floor(c).astype(int), 0, ncol - 2)
            fr = (r - r0)[:, None]
            fc = (c - c0)[None, :]
            v = (tile[np.ix_(r0, c0)] * (1 - fr) * (1 - fc)
                 + tile[np.ix_(r0 + 1, c0)] * fr * (1 - fc)
                 + tile[np.ix_(r0, c0 + 1)] * (1 - fr) * fc
                 + tile[np.ix_(r0 + 1, c0 + 1)] * fr * fc)
            out[np.ix_(rows, cols)] = v
    return out


# --- Land cover ---

LANDCOVER_CLASSES = {"open": 0, "forest": 1, "farmland": 2, "water": 3}
LANDCOVER_TILE_DEG = (0.1, 0.2)  # lat x lon per Overpass query, ~11 x 11 km here
LANDCOVER_PAUSE_S = 2.0          # between uncached Overpass requests


def landcover_class(tags):
    if tags.get("natural") == "water" or tags.get("landuse") == "reservoir":
        return "water"
    if tags.get("landuse") == "forest" or tags.get("natural") == "wood":
        return "forest"
    if tags.get("landuse") in ("farmland", "meadow"):
        return "farmland"
    return None


def join_rings(lines):
    """Join open member ways ([(lon, lat), ...]) end to end into closed rings;
    fragments that never close are dropped."""
    rings, lines = [], [list(l) for l in lines if len(l) >= 2]
    while lines:
        ring = lines.pop()
        while ring[0] != ring[-1]:
            for i, l in enumerate(lines):
                if l[0] == ring[-1]:
                    ring += l[1:]
                elif l[-1] == ring[-1]:
                    ring += l[-2::-1]
                else:
                    continue
                lines.pop(i)
                break
            else:
                break
        if ring[0] == ring[-1] and len(ring) >= 4:
            rings.append(ring)
    return rings


def fetch_landcover(south, west, north, east):
    """OSM land-cover polygons over the bbox as {class: [(outers, inners)]},
    one Overpass query per tile, deduplicated by element id across tiles."""
    dlat, dlon = LANDCOVER_TILE_DEG
    seen, polys = set(), {c: [] for c in LANDCOVER_CLASSES if c != "open"}
    lat0s = np.arange(math.floor(south / dlat) * dlat, north, dlat)
    lon0s = np.arange(math.floor(west / dlon) * dlon, east, dlon)
    for s in lat0s:
        for w in lon0s:
            bb = f"{s:.2f},{w:.2f},{s + dlat:.2f},{w + dlon:.2f}"
            sel = "".join(f'{t}["{k}"~"^({v})$"]({bb});' for t in ("way", "relation")
                          for k, v in (("landuse", "forest|farmland|meadow|reservoir"),
                                       ("natural", "wood|water")))
            query = f"[out:json][timeout:180];({sel});out geom;"
            cache = f"landcover_{bb.replace(',', '_')}.json"
            cached = os.path.exists(os.path.join(CACHE_DIR, cache))
            body = fetch_cached(OVERPASS_URL, cache,
                                data=("data=" + urllib.parse.quote(query)).encode())
            elements = json.loads(body)["elements"]
            print(f"  tile {bb}: {len(elements)} elements{' (cached)' if cached else ''}")
            if not cached:
                time.sleep(LANDCOVER_PAUSE_S)
            for el in elements:
                cls = landcover_class(el.get("tags", {}))
                if cls is None or (el["type"], el["id"]) in seen:
                    continue
                seen.add((el["type"], el["id"]))
                if el["type"] == "way":
                    members = [("outer", el.get("geometry"))]
                else:
                    members = [(m.get("role"), m.get("geometry"))
                               for m in el.get("members", []) if m["type"] == "way"]
                lines = {"outer": [], "inner": []}
                for role, geom in members:
                    if geom and role in lines:
                        lines[role].append([(p["lon"], p["lat"]) for p in geom])
                polys[cls].append((join_rings(lines["outer"]), join_rings(lines["inner"])))
    for cls, p in polys.items():
        print(f"  {cls}: {len(p)} polygons")
    return polys


def rasterise_landcover(polys, meta, grid):
    """Class-index image on the DEM grid: pixel (j, i) = sample [i][j]."""
    w, h = meta["width"], meta["height"]
    dlat = (meta["north"] - meta["south"]) / (h - 1)
    dlon = (meta["east"] - meta["west"]) / (w - 1)

    def px(ring):  # +0.5: PIL pixel j spans [j, j+1), its sample sits at the centre
        return [((lon - meta["west"]) / dlon + 0.5, (meta["north"] - lat) / dlat + 0.5)
                for lon, lat in ring]

    out = np.zeros((h, w), dtype=np.uint8)
    for cls in ("farmland", "forest", "water"):  # later classes win
        mask = Image.new("1", (w, h), 0)
        draw = ImageDraw.Draw(mask)
        for outers, inners in polys[cls]:
            for r in outers:
                draw.polygon(px(r), fill=1)
            for r in inners:
                draw.polygon(px(r), fill=0)
        out[np.array(mask, dtype=bool)] = LANDCOVER_CLASSES[cls]
    out[grid <= 1.0] = LANDCOVER_CLASSES["water"]  # sea
    for cls, v in LANDCOVER_CLASSES.items():
        print(f"  {cls}: {np.mean(out == v) * 100:.1f} %")
    return out


# --- Main ---

def main():
    global CACHE_DIR
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("config", nargs="?", default="config/world.yaml",
                    help="sen run YAML holding the origin (default config/world.yaml)")
    ap.add_argument("--spacing-m", type=float, default=30.0,
                    help="theatre DEM grid spacing (default 30, the source resolution)")
    ap.add_argument("--name", default=None,
                    help="area directory name (default: from origin coords)")
    ap.add_argument("--theatre-km", default="60x40", metavar="WxH",
                    help="theatre extent, W x H km centred on the origin (default 60x40)")
    ap.add_argument("--cache-dir", default=CACHE_DIR,
                    help=f"download cache (default {CACHE_DIR})")
    args = ap.parse_args()
    CACHE_DIR = args.cache_dir

    with open(args.config) as f:
        # sen run YAML allows bare `@env(NAME,default)` scalars, which PyYAML
        # refuses ('@' cannot start a token) — quote them (only bare ones: an
        # @env inside a quoted string is fine), we only want origin.
        text = re.sub(r"(:\s*)(@env\([^)]*\))", r'\1"\2"', f.read())
        origin = find_origin(yaml.safe_load(text))
    if not origin:
        sys.exit(f"no origin: {{latitude, longitude}} found in {args.config}")
    lat, lon = origin
    name = args.name or f"area_{lat:.3f}_{lon:.3f}".replace("-", "m").replace(".", "p")

    viz_dir = os.path.dirname(os.path.abspath(__file__))  # this script lives in viz/
    out_dir = os.path.join(viz_dir, "data", name)
    os.makedirs(out_dir, exist_ok=True)

    def make_grid(fname, half_w_km, half_h_km, spacing_m):
        dlat = spacing_m / M_PER_DEG_LAT
        dlon = spacing_m / (M_PER_DEG_LAT * math.cos(math.radians(lat)))
        half_w = round(half_w_km * 1000 / spacing_m)
        half_h = round(half_h_km * 1000 / spacing_m)
        # Grid registration: the bounds are the CENTER coordinates of the edge
        # samples; row 0 = north, sample [i][j] sits at
        # (north - i*dlat, west + j*dlon).
        lats = lat + dlat * np.arange(half_h, -half_h - 1, -1)
        lons = lon + dlon * np.arange(-half_w, half_w + 1)
        print(f"DEM {fname}: {len(lons)}x{len(lats)} grid @ {spacing_m:.0f} m over "
              f"{lats[-1]:.4f}..{lats[0]:.4f}N {lons[0]:.4f}..{lons[-1]:.4f}E")
        grid = sample_dem(lats, lons)
        print(f"  grid: {grid.min():.0f}..{grid.max():.0f} m")
        grid = np.round(grid).astype("<i2")
        grid.tofile(os.path.join(out_dir, fname))
        return {"file": fname, "spacingM": spacing_m,
                "north": lats[0], "south": lats[-1],
                "west": lons[0], "east": lons[-1],
                "width": len(lons), "height": len(lats)}, grid

    # The theatre: one fine grid over the whole theatre plus land cover on the same grid.
    w_km, h_km = (float(v) for v in args.theatre_km.lower().split("x"))
    theatre, tgrid = make_grid("dem_theatre.bin", w_km / 2, h_km / 2, args.spacing_m)
    print("Land cover over the theatre:")
    polys = fetch_landcover(theatre["south"], theatre["west"],
                            theatre["north"], theatre["east"])
    cover = rasterise_landcover(polys, theatre, tgrid)
    Image.fromarray(cover).save(os.path.join(out_dir, "landcover.png"), optimize=True)
    theatre.update({
        "extentKm": [w_km, h_km],
        "landcover": {
            "file": "landcover.png",
            "format": "8-bit greyscale PNG, one pixel per theatre DEM sample "
                      "(pixel x=j, y=i = sample [i][j]); value = class index",
            "classes": LANDCOVER_CLASSES,
            "seaRule": "DEM <= 1 m is water",
            "source": OSM_SOURCE, "license": OSM_LICENSE,
        },
    })

    sidecar = {
        "name": name,
        "originLat": lat, "originLon": lon,
        "format": "int16 little-endian metres, row-major, row 0 = north; "
                  "bounds are edge-sample centers",
        "datum": "orthometric (AMSL) heights used directly as ellipsoid "
                 "heights — the project's AMSL-as-ellipsoid convention",
        "demSource": DEM_SOURCE, "demLicense": DEM_LICENSE,
        "demAttribution": DEM_ATTRIBUTION,
        "config": os.path.basename(args.config),
        "theatre": theatre,
    }
    with open(os.path.join(out_dir, "dem.json"), "w") as f:
        json.dump(sidecar, f, indent=1)

    index_path = os.path.join(viz_dir, "data", "index.json")
    index = {"areas": []}
    if os.path.exists(index_path):
        with open(index_path) as f:
            index = json.load(f)
    if name not in index["areas"]:
        index["areas"].append(name)
    with open(index_path, "w") as f:
        json.dump(index, f, indent=1)

    total = sum(os.path.getsize(os.path.join(out_dir, p))
                for p in os.listdir(out_dir))
    print(f"Wrote viz/data/{name}/ ({total / 1e6:.1f} MB) and updated index.json")


if __name__ == "__main__":
    main()
