/**
 * Dependencies
 */
var http    = require('http');
var https   = require('https');
var fs      = require('fs');
var path    = require('path');
var ws      = require('ws');
var modules = require('./modules');
var mes     = require('./message');
var monitor = require('./monitor');

/**
 * Proxy constructor
 */
var Proxy = require('./proxy');

/**
 * Initiate a server
 */
var Server = function Init(config) {
	var opts = {
		clientTracking: false,
		verifyClient:   onRequestConnect
	};

	var requestHandler = function(req, res) {
		if (req.url === '/api/dashboard') {
			res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache'});
			res.end(JSON.stringify(monitor.getDashboardStats()));
			return;
		}

		if (req.url === '/' || req.url === '/index.html') {
			var indexPath = path.join(process.cwd(), 'index.html');
			if (fs.existsSync(indexPath)) {
				res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
				res.end(fs.readFileSync(indexPath));
				return;
			}
		}

		res.writeHead(200, {'Content-Type': 'text/plain; charset=utf-8'});
		res.end("wsProxy running...\nDashboard API: /api/dashboard\n");
	};

	if(config.ssl) {
		opts.server = https.createServer({
			key: fs.readFileSync(config.key),
			cert: fs.readFileSync(config.cert),
		}, requestHandler);

		opts.server.listen(config.port);
		mes.status("Starting a secure wsProxy on port %s...", config.port);
	}
	else {
		opts.server = http.createServer(requestHandler);

		opts.server.listen(config.port);
		mes.status("Starting wsProxy on port %s...", config.port);
	}

	var WebSocketServer = new ws.Server(opts);

	WebSocketServer.on('connection', onConnection);

	return this;
};

/**
 * Before establishing a connection
 */
function onRequestConnect(info, callback) {
	modules.method.verify(info, function(res) {
		callback(res);
	});
}

/**
 * Connection passed through verify, lets initiate a proxy
 */
function onConnection(ws) {
	modules.method.connect(ws, function() {
		new Proxy(ws);
	});
}

/**
 * Exports
 */
module.exports = Server;
