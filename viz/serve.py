#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Static file server for viz/ with a same-origin reverse proxy for /api.

The SEN REST component cannot serve static files and does not answer CORS
preflights, so the browser must see one origin. Run alongside `sen run`:

    python3 viz/serve.py                       # http://localhost:8000 -> REST 127.0.0.1:8080
    SEN_REST=http://localhost:8085 python3 viz/serve.py   # another REST (a URL or host:port)

Also POST /spawn {"lat", "lon"} and /kill {"id"}: start / remove a drone's compose project with
`docker compose -p drone<id> -f docker/drone.compose.yml up -d --no-build` / `down` — the same command as
scripts/spawn_drone.sh (keep the two in sync). POST /reset: an ordered restart of the stack to
scenarios/initial.yaml (ARCHITECTURE.md §7); one lock for all three, busy -> 409. A dev tool: the Docker socket is root-equivalent, never
expose this server beyond localhost. /api and every POST need a localhost Host header (DNS rebinding) and,
when the browser sends one, a same-origin Origin.
"""

import http.client
import http.server
import json
import math
import os
import socket
import subprocess
import threading
import time
import urllib.parse

LISTEN_PORT = 8000
# Default to loopback: the proxy forwards unauthenticated sim control, so exposing
# it is an explicit choice (a web container would set SEN_WEB_BIND=0.0.0.0).
LISTEN_HOST = os.environ.get("SEN_WEB_BIND", "127.0.0.1")
# Upstream SEN REST as a URL or host:port, the same SEN_REST as scripts/smoke.sh and scenario.py
# (SEN_REST=world:8080 in compose)
_rest = urllib.parse.urlsplit(("" if "//" in os.environ.get("SEN_REST", "") else "//") + os.environ.get("SEN_REST", "127.0.0.1:8080"))
SEN_REST = (_rest.hostname or "127.0.0.1", _rest.port or 8080)
# Host headers we answer /api and POSTs for: localhost on the served port, or on the host port compose publishes
# it on (WEB_PORT); any other Host is a DNS-rebinding page.
LOCAL_HOSTS = {f"{h}:{p}" for h in ("localhost", "127.0.0.1", "[::1]")
               for p in {LISTEN_PORT, int(os.environ.get("WEB_PORT") or LISTEN_PORT)}}
HOP_HEADERS = {"connection", "keep-alive", "transfer-encoding", "te", "upgrade", "host"}

# --- drone compose projects --------------------------------------------------------------------------------------
# Host path of the repo: bind-mount sources are resolved by the Docker daemon on the HOST, not in the
# web container (up.sh exports DRONE_SIM_ROOT, compose passes it); natively it is simply this file's parent directory.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRONE_SIM_ROOT = os.environ.get("DRONE_SIM_ROOT") or ROOT
POD_FILE = os.path.join(ROOT, "docker", "drone.compose.yml")  # mounted there in the web container
# The simulator version for the top bar (GET /version): the tag, or the commit's sha1 plus -dirty with
# uncommitted changes; up.sh passes it as SIM_VERSION (the web image has no .git), natively git answers.
def sim_version():
    try:
        return subprocess.run(["git", "-C", ROOT, "describe", "--tags", "--always", "--dirty"],
                              capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"
SIM_VERSION = os.environ.get("SIM_VERSION") or sim_version()
DRONE_LABEL = "drone_sim.drone"  # every container of a drone's compose project carries it (docker/drone.compose.yml)


def drone_compose(n, *args, **env):
    """`docker compose` on drone n's compose project -> (ok, output). Env (COMPOSE_PROFILES) is inherited."""
    r = subprocess.run(["docker", "compose", "-p", f"drone{n}", "-f", POD_FILE, *args], capture_output=True, text=True,
                       timeout=120, env=dict(os.environ, DRONE_ID=n, DRONE_SIM_ROOT=DRONE_SIM_ROOT, **env))
    return r.returncode == 0, (r.stdout + r.stderr).strip()


def drone_ids():
    out = subprocess.run(["docker", "ps", "-a", "--filter", "label=" + DRONE_LABEL, "--format",
                          '{{.Label "%s"}}' % DRONE_LABEL], capture_output=True, text=True, timeout=30, check=True).stdout
    return {int(i) for i in out.split() if i.isdigit()}


def spawn_drone(lat, lon):
    """Next free id (1 + the highest drone_sim.drone label), then its compose project, as scripts/spawn_drone.sh."""
    n = str(max(drone_ids(), default=0) + 1)
    # --no-build: images are built by scripts/up.sh only (one build at a time); this container has no build context
    ok, out = drone_compose(n, "up", "-d", "--no-build", START_LATITUDE=str(lat), START_LONGITUDE=str(lon))
    return (200, {"id": n}) if ok else (502, {"error": f"spawn drone{n}: {out}"})


def kill_drone(n):
    if int(n) not in drone_ids():
        return 404, {"error": f"no drone compose project drone{n}"}  # never world, ground_station or web
    ok, out = drone_compose(n, "--profile", "*", "down")  # every profile: partner containers too
    return (200, {"id": n}) if ok else (502, {"error": f"remove drone{n}: {out}"})


# --- reset -----------------------------------------------------------------------------------------------------------
LOCK = threading.Lock()  # /spawn, /kill and /reset: one compose change at a time
INITIAL = os.path.join(ROOT, "scenarios", "initial.yaml")  # mounted at /app/scenarios in the web container


def docker(*args):
    """`docker <args>` -> stdout; raises RuntimeError with the failing command's output."""
    r = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=120)
    if r.returncode:
        raise RuntimeError(f"docker {' '.join(args)}: {(r.stdout + r.stderr).strip()}")
    return r.stdout


def reset():
    """Every drone down, base containers but world/web stopped, world restarted, the rest started, initial drones up."""
    try:  # this container's own compose project (no hostname: set on web, so the hostname is the container id)
        project = docker("inspect", "-f", '{{index .Config.Labels "com.docker.compose.project"}}', socket.gethostname()).strip()
    except RuntimeError:
        project = ""
    if not project:
        return 501, {"error": "reset needs the compose stack (use scripts/scenario.py initial)"}
    import yaml  # lazy: only /reset needs it (pip-installed in drone_sim/web)
    with open(INITIAL) as f:
        drones = yaml.safe_load(f)["drones"]
    base = dict(line.split() for line in docker("ps", "-a", "--filter", "label=com.docker.compose.project=" + project,
                                                "--format", '{{.Names}} {{.Label "com.docker.compose.service"}}').splitlines())
    world = [n for n, svc in base.items() if svc == "world"]
    others = [n for n, svc in base.items() if svc not in ("world", "web")]
    if not world:
        raise RuntimeError(f"no world container in compose project {project}")
    errors = []
    downs = [threading.Thread(target=lambda n=n: errors.append(drone_compose(n, "--profile", "*", "down")))
             for n in map(str, sorted(drone_ids()))]
    for t in downs:
        t.start()
    for t in downs:
        t.join()
    failed = [out for ok, out in errors if not ok]
    if failed:
        raise RuntimeError(f"drone down: {failed[0]}")
    if others:
        docker("stop", *others)
    docker("restart", *world)  # also starts a world that had exited
    deadline = time.time() + 60
    while True:  # REST up = the world's kernel is running
        try:
            socket.create_connection(SEN_REST, timeout=2).close()
            break
        except OSError:
            if time.time() > deadline:
                raise RuntimeError(f"world REST {SEN_REST} not up after 60 s")
            time.sleep(1)
    if others:
        docker("start", *others)
    for n, position in drones.items():
        start = dict(START_LATITUDE=str(position[0]), START_LONGITUDE=str(position[1])) if position else {}
        ok, out = drone_compose(str(n), "up", "-d", "--no-build", **start)
        if not ok:
            raise RuntimeError(f"spawn drone{n}: {out}")
    return 200, {"drones": [str(n) for n in drones]}


def ask_rest(request, method, sse):
    """Send one request to SEN REST -> (socket, response with headers read). While a reset holds the lock,
    `world` is down or going down: retry rather than answer 502 (a reconnecting page logs every 502)."""
    deadline = time.time() + 60
    while True:
        sock = None
        try:
            sock = socket.create_connection(SEN_REST, timeout=5)
            # SSE streams are idle between updates — no read timeout there.
            # Plain requests get one so a hung backend can't wedge the thread.
            sock.settimeout(None if sse else 30)
            sock.sendall(request)
            resp = http.client.HTTPResponse(sock, method=method)
            resp.begin()
            return sock, resp
        except (ConnectionError, OSError, http.client.HTTPException):
            if sock:
                sock.close()
            if not LOCK.locked() or time.time() > deadline:
                raise
            time.sleep(0.5)


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript"}  # ES modules

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.dirname(os.path.abspath(__file__)), **kwargs)

    def end_headers(self):
        # Revalidate every file on each load (a cheap 304 via Last-Modified): without it the browser
        # heuristically caches ES modules and can mix an old module with a new one after an update.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def refused(self):
        """403 unless Host is localhost (DNS rebinding) and Origin, when sent, is this origin (another page the
        user visits; curl sends no Origin)."""
        host, origin = self.headers.get("Host", ""), self.headers.get("Origin")
        if host.lower() not in LOCAL_HOSTS or (origin and urllib.parse.urlsplit(origin).netloc != host):
            self.send_error(403, "foreign Host or Origin refused")
            return True
        return False

    def do_GET(self):
        if self.path == "/version":
            body = SIM_VERSION.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif not self.path.startswith("/api"):
            super().do_GET()
        elif not self.refused():
            self.proxy()

    def do_POST(self):
        if self.refused():
            pass
        elif self.path.startswith("/api"):
            self.proxy()
        elif self.path in ("/spawn", "/kill", "/reset"):
            self.drones()
        else:
            self.send_error(405)

    def drones(self):
        req = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        if not LOCK.acquire(blocking=False):
            status, body = 409, {"error": "busy: a reset, spawn or remove is running"}
        else:
            try:
                status, body = self.compose(req)
            finally:
                LOCK.release()
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def compose(self, raw):
        try:
            req = json.loads(raw or "{}")
            if self.path == "/reset":
                status, body = reset()
            elif self.path == "/spawn":
                lat, lon = float(req["lat"]), float(req["lon"])
                if not (math.isfinite(lat) and math.isfinite(lon) and abs(lat) <= 90 and abs(lon) <= 180):
                    raise ValueError("lat/lon out of range")
                status, body = spawn_drone(lat, lon)
            else:
                n = str(req["id"])
                if not n.isdigit():
                    raise ValueError("id must be an integer")
                status, body = kill_drone(n)
        except (KeyError, TypeError, ValueError) as e:
            status, body = 400, {"error": str(e)}
        except RuntimeError as e:  # a reset command failed
            status, body = 502, {"error": str(e)}
        except (OSError, subprocess.SubprocessError) as e:  # no docker CLI or socket, daemon down
            status, body = 503, {"error": f"docker unavailable: {e}"}
        return status, body

    def proxy(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""

        # SEN's REST server resets the connection if the request body arrives
        # in a separate TCP segment from the headers (as http.client sends it),
        # so compose the full request and send it in a single sendall().
        path, cookie = self.path, None
        if path.startswith("/api/sse?token="):  # EventSource cannot send headers: the page's own token as the cookie
            path, cookie = "/api/sse", "token=" + urllib.parse.unquote(path.partition("=")[2])  # (sen_client.js)
        lines = [f"{self.command} {path} HTTP/1.1", f"Host: {SEN_REST[0]}:{SEN_REST[1]}"]
        for k, v in self.headers.items():
            if k.lower() not in HOP_HEADERS and not (cookie and k.lower() == "cookie"):
                lines.append(f"{k}: {v}")
        if cookie:
            lines.append(f"Cookie: {cookie}")
        lines.append("Connection: close")
        request = ("\r\n".join(lines) + "\r\n\r\n").encode() + body

        try:
            sock, resp = ask_rest(request, self.command, path == "/api/sse")
        except (ConnectionError, OSError, http.client.HTTPException) as e:
            self.send_error(502, f"SEN REST unreachable: {e}")
            return

        self.send_response(resp.status)
        for k, v in resp.getheaders():
            if k.lower() in HOP_HEADERS:
                continue
            if k.lower() == "set-cookie":
                # SEN sets `Secure`; harmless on localhost but strip defensively
                v = v.replace("; Secure", "").replace(";Secure", "")
            self.send_header(k, v)
        self.end_headers()

        # Stream chunk-by-chunk — required for /api/sse to flow without stalls
        try:
            while True:
                chunk = resp.read1(65536)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (ConnectionError, OSError):
            pass  # client or backend went away mid-stream
        finally:
            sock.close()

    def log_message(self, fmt, *args):
        if not self.path.startswith("/api"):  # keep SSE/poll noise out of the console
            super().log_message(fmt, *args)


if __name__ == "__main__":
    print(f"Serving viz/ on http://localhost:{LISTEN_PORT} (bind {LISTEN_HOST}, "
          f"proxying /api -> {SEN_REST[0]}:{SEN_REST[1]})")
    http.server.ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler).serve_forever()
