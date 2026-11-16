'use strict';
const { loadConfig } = require('./config');
const { createApp } = require('./app');

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`\nConfig error: ${err.message}\n`);
  process.exit(1);
}

const server = createApp(config);
server.listen(config.port, config.host, () => {
  const shown = config.host === '0.0.0.0' ? 'localhost' : config.host;
  console.log(`SpendWise running at http://${shown}:${config.port}  (${config.production ? 'production' : 'development'})`);
  console.log(`Database: ${config.dbFile}`);
  if (!config.allowSignup) console.log('Sign-ups are disabled (ALLOW_SIGNUP=false).');
});

function shutdown(signal) {
  console.log(`\n${signal} received, shutting down...`);
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
