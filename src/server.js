require('dotenv').config();
const app = require('./app');
const { getPool, closePool } = require('./config/database');

const port = Number(process.env.PORT || 3000);
let server;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received. Shutting down gracefully...`);

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await closePool();
  process.exit(0);
}

async function start() {
  try {
    await getPool();
    server = app.listen(port, () => {
      console.log(`Appointment API listening on port ${port}`);
    });
  } catch (error) {
    console.error('Unable to start API. Check SQL Server configuration and connectivity:', error.message);
    process.exitCode = 1;
    await closePool().catch(() => {});
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
