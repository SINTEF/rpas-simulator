// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// SEN REST/SSE client, generalized over interests (one per bus).
// Flow (order matters): auth → open SSE → create interests → poll existing
// objects. SSE must be open before interests are created so the server-side
// observer exists when interest notifications fire.
//
// Reconnect: SEN interests and subscriptions are per-session (per auth
// token), so a dropped SSE stream cannot simply be reopened — updates missed
// during the gap are gone and the old session may be too. Instead the client
// treats any SSE error as a hard disconnect: it replays object removals (so
// the app clears rendered state instead of showing stale data), then retries
// the full init sequence (fresh auth → SSE → interests → discovery) until
// the backend is reachable again. The app observes this via
// onConnectionChange(connected).

class SenClient {
  // clientId: a prefix. SEN keys REST sessions by id and DESTROYS the previous
  // session when an id re-auths (sen_router.cpp clientAuthSessionHandler); at
  // SEN 05da288e that teardown segfaults the process hosting the objects when
  // another session subscribes to the same property (use-after-move in
  // native_object_proxy.cpp senImplRemoveUntypedConnection). So every connect
  // attempt auths with a fresh id (_connectOnce) and never re-auths an old one;
  // the cost is one leaked server session per page load or reconnect.
  constructor(clientId) {
    this.clientId = clientId || "web-frontend";
    this.token = null; // this page's bearer token (see _connectOnce)
    this.eventSource = null;
    this.knownObjects = new Set(); // "interest:name"
    this.connected = false;

    // Callbacks — set by the app before init()
    this.onObjectAdded = null;   // (interest, name, className) — className as SEN reports it ("DroneTruth")
    this.onObjectRemoved = null; // (interest, name)
    this.onProperty = null;      // (interest, name, property, value)
    this.onConnectionChange = null; // (connected: bool)

    this._interests = null;      // remembered for reconnect
    this._reconnecting = false;
  }

  // The auth token cookie is shared across ALL tabs of the origin and the
  // server prefers it over the Authorization header — so once this page has
  // its own token, send it as a Bearer header and OMIT cookies, or another
  // tab's later auth would silently redirect this page's REST calls to that
  // tab's session.
  _fetchOpts() {
    return this.token
      ? { headers: { Authorization: `Bearer ${this.token}` }, credentials: "omit" }
      : { headers: {}, credentials: "include" };
  }

  async get(href) {
    const opts = this._fetchOpts();
    const response = await fetch(href, {
      headers: { Accept: "application/json", ...opts.headers },
      credentials: opts.credentials,
    });
    if (!response.ok) throw new Error(`GET ${href}: ${response.status}`);
    return response.json();
  }

  async postJSON(href, body) {
    const opts = this._fetchOpts();
    const response = await fetch(href, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json",
                 ...opts.headers },
      credentials: opts.credentials,
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`POST ${href}: ${response.status}`);
    return response.json();
  }

  async invoke(interest, objectName, methodName, args = []) {
    return this.postJSON(
      `/api/interests/${interest}/objects/${objectName}/methods/${methodName}/invoke`,
      args
    );
  }

  async getProperty(interest, objectName, propertyName) {
    return this.get(`/api/interests/${interest}/objects/${objectName}/properties/${propertyName}`);
  }

  async subscribeProperty(interest, objectName, propertyName) {
    return this.postJSON(
      `/api/interests/${interest}/objects/${objectName}/properties/${propertyName}/subscribe`,
      {}
    );
  }

  discoverObject(interest, name, className) {
    const key = `${interest}:${name}`;
    if (this.knownObjects.has(key)) return;
    this.knownObjects.add(key);
    if (this.onObjectAdded) this.onObjectAdded(interest, name, className);
  }

  removeObject(interest, name) {
    const key = `${interest}:${name}`;
    if (!this.knownObjects.has(key)) return;
    this.knownObjects.delete(key);
    if (this.onObjectRemoved) this.onObjectRemoved(interest, name);
  }

  enableSSE() {
    return new Promise((resolve, reject) => {
      // EventSource can't send headers: the token goes in the query and serve.py turns it into the
      // cookie SEN reads, so this stream is this page's session whatever cookie another tab set last.
      const es = new EventSource(`/api/sse?token=${encodeURIComponent(this.token)}`);
      this.eventSource = es;
      let opened = false;

      es.addEventListener("object_added", (event) => {
        const msg = JSON.parse(event.data);
        this.discoverObject(msg.interest, msg.data.name, msg.data.className);
      });

      es.addEventListener("object_removed", (event) => {
        const msg = JSON.parse(event.data);
        this.removeObject(msg.interest, msg.data.name);
      });

      es.addEventListener("property", (event) => {
        const msg = JSON.parse(event.data);
        if (this.onProperty) {
          this.onProperty(msg.interest, msg.data.name, msg.data.property, msg.data.value);
        }
      });

      es.onopen = () => { opened = true; resolve(); };
      es.onerror = () => {
        // Don't let the browser's built-in retry reuse the dead session (see
        // class comment) — close and go through the full-resync path instead.
        es.close();
        if (!opened) {
          reject(new Error("SSE connection failed"));
        } else if (es === this.eventSource) {
          this._handleDisconnect();
        }
      };
    });
  }

  // Poll for objects that existed before the interest was created
  async discoverExisting(interest) {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const objects = await this.get(`/api/interests/${interest}/objects`);
        if (objects.length > 0) {
          for (const obj of objects) this.discoverObject(interest, obj.name, obj.className);
          return;
        }
      } catch (e) {
        // interest may not have resolved yet — retry
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // interests: { name: "SELECT * FROM bus", ... }
  // Resolves on the first successful connect; afterwards the client keeps
  // itself connected (see class comment). Rejects only if the very first
  // attempt fails — and even then a retry loop is already running.
  async init(interests) {
    this._interests = interests;
    try {
      await this._connectOnce();
      this._setConnected(true);
    } catch (e) {
      this._handleDisconnect();
      throw e;
    }
  }

  async _connectOnce() {
    // Auth, then everything with this page's own token: REST calls as a Bearer
    // header (_fetchOpts), the SSE stream as ?token= (enableSSE, serve.py). A
    // shared cookie would let tabs that reconnect together (Reset simulation)
    // steal each other's session.
    this.token = null;
    const id = `${this.clientId}-${Math.random().toString(36).slice(2, 8)}`;
    const auth = await this.postJSON("/api/auth", { id });
    this.token = auth.token;
    // SEN sends the SSE response headers only with the first event, and no event comes before an
    // interest exists: open the stream, create the interests, then wait for it to open.
    const sse = this.enableSSE();
    sse.catch(() => {}); // awaited below; this only silences an early rejection
    for (const [name, query] of Object.entries(this._interests)) {
      await this.postJSON("/api/interests", { name, query });
    }
    await sse;
    await Promise.all(Object.keys(this._interests).map((name) => this.discoverExisting(name)));
    console.log("SEN client connected");
  }

  _setConnected(connected) {
    if (this.connected === connected) return;
    this.connected = connected;
    if (this.onConnectionChange) this.onConnectionChange(connected);
  }

  _handleDisconnect() {
    if (this._reconnecting) return;
    this._reconnecting = true;
    this._dropSession();
    this._retryLoop();
  }

  // Forget a session (a dropped one, or a reconnect attempt that failed half-way): close its SSE stream
  // so it cannot deliver objects into the next session, and replay removals so every object is
  // discovered, and subscribed, again in the next one.
  _dropSession() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this._setConnected(false);
    // Replay removals so the app drops rendered state instead of freezing on
    // stale data; reconnection re-adds everything through normal discovery.
    for (const key of [...this.knownObjects]) {
      const sep = key.indexOf(":");
      this.removeObject(key.slice(0, sep), key.slice(sep + 1));
    }
  }

  async _retryLoop() {
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        await this._connectOnce();
        this._reconnecting = false;
        this._setConnected(true);
        return;
      } catch (e) {
        this._dropSession(); // backend still down or half up — start clean next time
      }
    }
  }
}
