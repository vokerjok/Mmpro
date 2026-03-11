/**
 * Dependencies
 */
var net = require('net');
var mes = require('./message');
var monitor = require('./monitor');

function normalizePayload(data) {
	if (typeof data === 'string') {
		return data;
	}
	if (Buffer.isBuffer(data)) {
		return data.toString('utf8');
	}
	return String(data || '');
}

function ensureLineDelimitedJson(data) {
	if (typeof data === 'string') {
		var trimmed = data.trim();
		if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && !data.endsWith('\n')) {
			return data + '\n';
		}
		return data;
	}

	if (Buffer.isBuffer(data)) {
		var str = data.toString('utf8');
		var trimmedBuf = str.trim();
		if ((trimmedBuf.startsWith('{') || trimmedBuf.startsWith('[')) && !str.endsWith('\n')) {
			return Buffer.from(str + '\n', 'utf8');
		}
		return data;
	}

	return data;
}

function parseFirstJsonObject(raw) {
	var text = String(raw || '').trim();
	if (!text) return null;
	var lines = text.split(/\r?\n/);
	for (var i = 0; i < lines.length; i++) {
		var line = lines[i].trim();
		if (!line || (line[0] !== '{' && line[0] !== '[')) continue;
		try {
			return JSON.parse(line);
		} catch (e) {}
	}
	if (text[0] === '{' || text[0] === '[') {
		try {
			return JSON.parse(text);
		} catch (e) {}
	}
	return null;
}

function pickLoginValue(msg) {
	if (!msg || typeof msg !== 'object') return '';
	var params = msg.params || msg.result || msg.data || {};
	var candidates = [
		params.login,
		params.user,
		params.username,
		params.wallet,
		params.address,
		params.account,
		params.result,
		params.auth,
		msg.login,
		msg.user,
		msg.username,
		msg.wallet,
		msg.address
	];
	for (var i = 0; i < candidates.length; i++) {
		if (candidates[i] != null && String(candidates[i]).trim()) {
			return String(candidates[i]).trim();
		}
	}
	return '';
}

/**
 * Constructor
 */
var Proxy = function Constructor(ws) {
	const to = ws.upgradeReq.url.substr(1);

	this._tcp = null;
	this._from = monitor.getClientIp(ws.upgradeReq);
	this._to = Buffer.from(to, 'base64').toString();
	this._ws = ws;
	this._closed = false;
	this._conn = null;
	this._walletCaptured = false;

	var args = this._to.split(':');

	this._host = args[0] || 'unknown';
	this._port = args[1] || '0';

	this._conn = monitor.createConnectionRecord({
		ip: this._from,
		target: this._to,
		host: this._host,
		port: this._port
	});

	this._ws.on('message', this.clientData.bind(this));
	this._ws.on('close', this.close.bind(this));
	this._ws.on('error', this.onWsError.bind(this));

	mes.info("Requested connection from '%s' to '%s' [ACCEPTED].", this._from, this._to);

	this._tcp = net.connect(this._port, this._host);

	this._tcp.setTimeout(0);
	this._tcp.setNoDelay(true);

	this._tcp.on('data', this.serverData.bind(this));
	this._tcp.on('close', this.close.bind(this));
	this._tcp.on('error', this.onTcpError.bind(this));
	this._tcp.on('connect', this.connectAccept.bind(this));
};

Proxy.prototype.captureWalletFromClientMessage = function(data) {
	if (!this._conn || this._walletCaptured) {
		return;
	}

	try {
		var raw = normalizePayload(data);
		var msg = parseFirstJsonObject(raw);
		if (!msg) return;

		var method = String(msg.method || msg.type || '').toLowerCase();
		if (method && method !== 'login' && method !== 'auth' && method !== 'authorize') {
			return;
		}

		var loginValue = pickLoginValue(msg);
		if (!loginValue) return;

		this._walletCaptured = true;
		monitor.updateConnection(this._conn.id, {
			wallet: loginValue,
			rawLogin: loginValue,
			loginPayload: raw
		});
	} catch (e) {}
};

/**
 * Client -> Pool
 */
Proxy.prototype.clientData = function OnServerData(data) {
	if (!this._tcp) {
		return;
	}

	try {
		this.captureWalletFromClientMessage(data);

		let out = ensureLineDelimitedJson(data);

		monitor.addClientBytes(
			this._conn.id,
			out && out.length ? out.length : Buffer.byteLength(out || '')
		);

		this._tcp.write(out);
	} catch(e) {
		this.close('ERROR', e && e.message ? e.message : 'client write error');
	}
};

/**
 * Pool -> Client
 */
Proxy.prototype.serverData = function OnClientData(data) {
	var self = this;

	monitor.addServerBytes(
		this._conn.id,
		data && data.length ? data.length : Buffer.byteLength(data || '')
	);

	this._ws.send(data, function(error){
		if (error) {
			self.close('ERROR', error.message || 'ws send error');
		}
	});
};

/**
 * Close connection
 */
Proxy.prototype.close = function OnClose(status, errorMessage) {
	if (this._closed) {
		return;
	}

	this._closed = true;

	monitor.closeConnection(this._conn.id, {
		status: status || 'CLOSED',
		error: errorMessage || null
	});

	if (this._tcp) {
		this._tcp.removeAllListeners('close');
		this._tcp.removeAllListeners('error');
		this._tcp.removeAllListeners('data');

		try { this._tcp.end(); } catch(e) {}
		try { this._tcp.destroy(); } catch(e) {}

		this._tcp = null;
	}

	if (this._ws) {
		this._ws.removeAllListeners('close');
		this._ws.removeAllListeners('error');
		this._ws.removeAllListeners('message');

		try { this._ws.close(); } catch(e) {}

		this._ws = null;
	}
};

/**
 * Pool accepted connection
 */
Proxy.prototype.connectAccept = function OnConnectAccept() {
	monitor.markActive(this._conn.id);
	mes.status("Connection accepted from '%s'.", this._to);
};

Proxy.prototype.onWsError = function(error) {
	console.log(error);
	this.close('ERROR', error && error.message ? error.message : 'ws error');
};

Proxy.prototype.onTcpError = function(error) {
	console.log(error);
	this.close('ERROR', error && error.message ? error.message : 'tcp error');
};

/**
 * Export
 */
module.exports = Proxy;
