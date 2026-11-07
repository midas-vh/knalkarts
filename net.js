// Netwerk: peer-to-peer via PeerJS. De host (wie de race maakt) is het centrum,
// alle andere telefoons praten alleen met de host.
const PREFIX = 'knalkarts-v1-';

export class Net {
  constructor() {
    this.reset();
    this.onMessage = null;   // (msg, fromId)
    this.onPeerLeave = null; // (id)   alleen host
    this.onHostLost = null;  // ()     alleen client
  }

  reset() {
    this.peer = null;
    this.conns = new Map();
    this.hostConn = null;
    this.isHost = false;
    this.offline = false;
    this.id = null;
  }

  startOffline() {
    this.close();
    this.isHost = true;
    this.offline = true;
    this.id = 'me';
  }

  host(code) {
    this.close();
    return new Promise((resolve, reject) => {
      if (typeof Peer === 'undefined') return reject(new Error('PeerJS kon niet laden'));
      const p = new Peer(PREFIX + code, { debug: 1 });
      let opened = false;
      const to = setTimeout(() => { if (!opened) { p.destroy(); reject(new Error('timeout')); } }, 12000);
      p.on('open', (id) => {
        opened = true; clearTimeout(to);
        this.peer = p; this.isHost = true; this.id = id;
        resolve();
      });
      p.on('connection', (conn) => {
        conn.on('open', () => this.conns.set(conn.peer, conn));
        conn.on('data', (d) => { if (this.peer === p) this.onMessage?.(d, conn.peer); });
        const gone = () => {
          if (this.conns.get(conn.peer) === conn) {
            this.conns.delete(conn.peer);
            this.onPeerLeave?.(conn.peer);
          }
        };
        conn.on('close', gone);
        conn.on('error', gone);
      });
      p.on('error', (e) => {
        if (!opened) { clearTimeout(to); p.destroy(); reject(e); }
        else console.warn('peer error', e.type);
      });
      p.on('disconnected', () => {
        // verbinding met de "telefoonboek"-server kwijt; bestaande spelers blijven werken
        if (this.peer === p && !p.destroyed) setTimeout(() => { try { p.reconnect(); } catch { /* */ } }, 1000);
      });
    });
  }

  join(code) {
    this.close();
    return new Promise((resolve, reject) => {
      if (typeof Peer === 'undefined') return reject(new Error('PeerJS kon niet laden'));
      const p = new Peer({ debug: 1 });
      let done = false;
      const fail = (e) => { if (done) return; done = true; clearTimeout(to); p.destroy(); reject(e); };
      const to = setTimeout(() => fail(new Error('timeout')), 15000);
      p.on('open', (id) => {
        this.peer = p; this.id = id; this.isHost = false;
        const c = p.connect(PREFIX + code, { serialization: 'json', reliable: true });
        c.on('open', () => {
          if (done) return;
          done = true; clearTimeout(to);
          this.hostConn = c;
          resolve();
        });
        c.on('data', (d) => { if (this.hostConn === c) this.onMessage?.(d, 'host'); });
        c.on('close', () => { if (this.hostConn === c) this.onHostLost?.(); });
        c.on('error', () => { if (this.hostConn === c) this.onHostLost?.(); });
      });
      p.on('error', (e) => {
        if (!done) { this.peer = null; fail(e); }
        else console.warn('peer error', e.type);
      });
    });
  }

  send(m) { const c = this.hostConn; if (c && c.open) try { c.send(m); } catch { /* */ } }
  sendTo(id, m) { const c = this.conns.get(id); if (c && c.open) try { c.send(m); } catch { /* */ } }
  broadcast(m, except) {
    for (const [id, c] of this.conns) if (id !== except && c.open) try { c.send(m); } catch { /* */ }
  }
  closeConn(id) { const c = this.conns.get(id); this.conns.delete(id); try { c?.close(); } catch { /* */ } }
  close() { const p = this.peer; this.reset(); if (p) try { p.destroy(); } catch { /* */ } }
}
