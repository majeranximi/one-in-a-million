// Peer-to-peer rooms over WebRTC. PeerJS's free public server only introduces the players;
// race data then flows directly between the browsers, so the game needs no server of its own.
import { Peer } from 'peerjs';

export const PROTOCOL = 1;
export const MAX_PLAYERS = 8;
const PREFIX = 'oiam-v1-';
// No 0/O or 1/I, so a code read out loud cannot be mistyped.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
const CONNECT_TIMEOUT_MS = 15000;
const PEER_OPTIONS = {
  debug: 0,
  config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] },
};

export function makeCode() {
  const values = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(values);
  return Array.from(values, (v) => ALPHABET[v % ALPHABET.length]).join('');
}

export function normalizeCode(text) {
  return String(text).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

export function isValidCode(code) {
  return code.length === CODE_LENGTH && [...code].every((ch) => ALPHABET.includes(ch));
}

export function cleanName(name) {
  return String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16);
}

function errorKind(err) {
  switch (err?.type) {
    case 'peer-unavailable': return 'notFound';
    case 'unavailable-id': return 'taken';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
    case 'disconnected': return 'server';
    default: return 'connect';
  }
}

// The host's side of a room: accepts players and passes their messages on.
export class HostRoom {
  constructor(name, events) {
    this.events = events;
    this.players = [{ id: 0, name, conn: null }];
    this.nextId = 1;
    this.accepting = true;
    this.attempts = 0;
    this.create();
  }

  create() {
    this.code = makeCode();
    this.ready = false;
    const peer = (this.peer = new Peer(PREFIX + this.code, PEER_OPTIONS));
    peer.on('open', () => {
      this.ready = true;
      this.events.onReady(this.code);
    });
    peer.on('connection', (conn) => this.accept(conn));
    // Losing the introduction server does not break open connections; reconnect so new players can still join.
    peer.on('disconnected', () => { if (!this.closed) peer.reconnect(); });
    peer.on('error', (err) => {
      const kind = errorKind(err);
      if (kind === 'taken' && this.attempts++ < 3) {
        peer.destroy();
        this.create();
        return;
      }
      if (!this.ready && !this.closed) this.events.onError(kind);
    });
  }

  accept(conn) {
    let player = null;
    conn.on('data', (msg) => {
      if (!player) {
        if (msg?.t !== 'hello') { conn.close(); return; }
        const reason = msg.v !== PROTOCOL ? 'version'
          : this.players.length >= MAX_PLAYERS ? 'full'
            : !this.accepting ? 'started' : null;
        if (reason) {
          conn.send({ t: 'reject', reason });
          setTimeout(() => conn.close(), 500);
          return;
        }
        player = { id: this.nextId++, name: cleanName(msg.name) || `#${this.nextId}`, conn };
        this.players.push(player);
        conn.send({ t: 'welcome', id: player.id, code: this.code });
        this.events.onJoin(player);
        return;
      }
      this.events.onMessage(player, msg);
    });
    conn.on('close', () => {
      if (!player || this.closed) return;
      this.players = this.players.filter((p) => p !== player);
      this.events.onLeave(player);
    });
    conn.on('error', () => conn.close());
  }

  send(player, msg) {
    if (player.conn?.open) player.conn.send(msg);
  }

  broadcast(msg) {
    for (const p of this.players) this.send(p, msg);
  }

  close() {
    this.closed = true;
    for (const p of this.players) p.conn?.close();
    this.peer.destroy();
  }
}

// A player's side: one connection to the host.
export class ClientRoom {
  constructor(code, name, events) {
    this.events = events;
    const peer = (this.peer = new Peer(PEER_OPTIONS));
    this.timer = setTimeout(() => this.fail('connect'), CONNECT_TIMEOUT_MS);
    peer.on('open', () => {
      const conn = (this.conn = peer.connect(PREFIX + code, { serialization: 'json', reliable: true }));
      conn.on('open', () => conn.send({ t: 'hello', v: PROTOCOL, name }));
      conn.on('data', (msg) => {
        if (msg?.t === 'reject') { this.fail(msg.reason); return; }
        if (msg?.t === 'welcome') { clearTimeout(this.timer); this.joined = true; }
        this.events.onMessage(msg);
      });
      conn.on('close', () => this.fail(this.joined ? 'hostLeft' : 'connect'));
    });
    peer.on('error', (err) => {
      const kind = errorKind(err);
      // Once joined, the introduction server no longer matters.
      if (this.joined && kind === 'server') return;
      this.fail(kind);
    });
  }

  fail(kind) {
    if (this.closed) return;
    this.close();
    this.events.onClosed(kind);
  }

  send(msg) {
    if (this.conn?.open) this.conn.send(msg);
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    try { this.peer.destroy(); } catch { /* already gone */ }
  }
}
