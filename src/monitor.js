const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'dashboard-state.json');

function now() {
  return new Date().toISOString();
}

function safeRead() {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return {
        totalConnections: 0,
        activeConnections: 0,
        blockedUsers: [],
        connections: [],
        updatedAt: now()
      };
    }
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    parsed.connections = Array.isArray(parsed.connections) ? parsed.connections : [];
    parsed.blockedUsers = Array.isArray(parsed.blockedUsers) ? parsed.blockedUsers : [];
    parsed.totalConnections = Number(parsed.totalConnections || 0);
    parsed.activeConnections = Number(parsed.activeConnections || 0);
    parsed.updatedAt = parsed.updatedAt || now();
    return parsed;
  } catch (e) {
    return {
      totalConnections: 0,
      activeConnections: 0,
      blockedUsers: [],
      connections: [],
      updatedAt: now()
    };
  }
}

function safeWrite(state) {
  state.updatedAt = now();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function getClientIp(req) {
  const forwarded = req && req.headers && req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  const ip =
    (req && req.socket && req.socket.remoteAddress) ||
    (req && req.connection && req.connection.remoteAddress) ||
    'unknown';
  return String(ip);
}

function createConnectionRecord(data) {
  const state = safeRead();
  const item = {
    id: 'conn_' + Date.now() + '_' + Math.random().toString(16).slice(2, 10),
    ip: data.ip || 'unknown',
    target: data.target || 'unknown:0',
    host: data.host || 'unknown',
    port: String(data.port || '0'),
    workerPid: process.pid,
    protocol: 'wsproxy',
    wallet: data.wallet || '-',
    algo: data.algo || '-',
    startTime: now(),
    endTime: null,
    bytesFromClient: 0,
    bytesToClient: 0,
    messagesFromClient: 0,
    messagesToClient: 0,
    status: 'CONNECTING',
    lastActivity: now(),
    error: null
  };

  state.totalConnections += 1;
  state.activeConnections += 1;
  state.connections.unshift(item);
  if (state.connections.length > 500) {
    state.connections = state.connections.slice(0, 500);
  }
  safeWrite(state);
  return item;
}

function updateConnection(id, patch) {
  const state = safeRead();
  const item = state.connections.find((x) => x.id === id);
  if (!item) return null;
  Object.assign(item, patch || {});
  item.lastActivity = now();

  state.activeConnections = state.connections.filter((x) => x.status === 'ACTIVE' || x.status === 'CONNECTING').length;
  safeWrite(state);
  return item;
}

function markActive(id) {
  return updateConnection(id, { status: 'ACTIVE' });
}

function addClientBytes(id, length) {
  const state = safeRead();
  const item = state.connections.find((x) => x.id === id);
  if (!item) return null;
  item.bytesFromClient += Number(length || 0);
  item.messagesFromClient += 1;
  item.lastActivity = now();
  safeWrite(state);
  return item;
}

function addServerBytes(id, length) {
  const state = safeRead();
  const item = state.connections.find((x) => x.id === id);
  if (!item) return null;
  item.bytesToClient += Number(length || 0);
  item.messagesToClient += 1;
  item.lastActivity = now();
  safeWrite(state);
  return item;
}

function closeConnection(id, extra) {
  const state = safeRead();
  const item = state.connections.find((x) => x.id === id);
  if (!item) return null;
  item.status = (extra && extra.status) || 'CLOSED';
  item.error = (extra && extra.error) || null;
  item.endTime = now();
  item.lastActivity = now();
  state.activeConnections = state.connections.filter((x) => x.status === 'ACTIVE' || x.status === 'CONNECTING').length;
  safeWrite(state);
  return item;
}

function getDashboardStats() {
  const state = safeRead();
  const active = state.connections.filter((x) => x.status === 'ACTIVE' || x.status === 'CONNECTING');
  const byHost = {};
  const byIp = {};
  active.forEach((x) => {
    byHost[x.host] = (byHost[x.host] || 0) + 1;
    byIp[x.ip] = (byIp[x.ip] || 0) + 1;
  });

  return {
    totalConnections: state.totalConnections,
    activeConnections: state.activeConnections,
    uniqueIps: Object.keys(byIp).length,
    uniqueTargets: Object.keys(byHost).length,
    updatedAt: state.updatedAt,
    blockedUsers: state.blockedUsers,
    topTargets: Object.keys(byHost).map((k) => ({ host: k, count: byHost[k] })).sort((a,b)=>b.count-a.count).slice(0, 10),
    recentConnections: state.connections.slice(0, 100),
    connections: state.connections
  };
}

module.exports = {
  STATE_FILE,
  getClientIp,
  createConnectionRecord,
  updateConnection,
  markActive,
  addClientBytes,
  addServerBytes,
  closeConnection,
  getDashboardStats
};
