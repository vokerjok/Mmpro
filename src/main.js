/**
 * Module
 */
var Main = module.exports = function Init(config)
{
	/**
	 * Dependencies
	 */
	var cluster = require('cluster');
	var fs = require('fs');
	var path = require('path');

	// Ensure dashboard state file exists before workers start
	var stateFile = path.join(__dirname, '..', 'dashboard-state.json');
	if (cluster.isMaster) {
		if (!fs.existsSync(stateFile)) {
			fs.writeFileSync(stateFile, JSON.stringify({
				totalConnections: 0,
				activeConnections: 0,
				blockedUsers: [],
				connections: [],
				updatedAt: new Date().toISOString()
			}, null, 2));
		}
	}

	/**
	 * Invoke workers
	 */
	if(cluster.isMaster) {
		for(var i = 0; i < config.workers; i++) {
			forkWorker(config);
		}

		cluster.on('exit', function() {
			forkWorker(config);
		});

		return;
	}

	/**
	 * Server constructor
	 */
	var Server  = require('./server');
	var server = new Server(config);

	/**
	 * Fork new worker
	 */
	function forkWorker(config) {
		cluster.fork({
			isWorker: true
		});
	}
}
