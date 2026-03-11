/**
 * Dependencies
 */
var net = require('net');
var mes = require('./message');
var monitor = require('./monitor');

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

/**
 * Client -> Pool
 */
Proxy.prototype.clientData = function OnServerData(data) {

	if (!this._tcp) {
		return;
	}

	try {

		let out = data;

		if (typeof data === 'string') {

			let trimmed = data.trim();

			if (
				(trimmed.startsWith('{') || trimmed.startsWith('[')) &&
				!data.endsWith('\n')
			) {
				out = data + '\n';
			}

		} else if (Buffer.isBuffer(data)) {

			let str = data.toString('utf8');
			let trimmed = str.trim();

			if (
				(trimmed.startsWith('{') || trimmed.startsWith('[')) &&
				!str.endsWith('\n')
			) {
				out = Buffer.from(str + '\n', 'utf8');
			}
		}

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