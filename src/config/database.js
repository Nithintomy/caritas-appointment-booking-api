const sql = require('mssql');

let poolPromise;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function toBoolean(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true';
}

function buildConfig(overrides = {}) {
  const options = {
    encrypt: toBoolean(process.env.DB_ENCRYPT, false),
    trustServerCertificate: toBoolean(process.env.DB_TRUST_SERVER_CERTIFICATE, true),
    enableArithAbort: true
  };

  const instanceName = process.env.DB_INSTANCE_NAME;
  const config = {
    server: requiredEnv('DB_SERVER'),
    database: overrides.database || requiredEnv('DB_NAME'),
    user: overrides.user || requiredEnv('DB_USER'),
    password: overrides.password || requiredEnv('DB_PASSWORD'),
    connectionTimeout: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 15000),
    requestTimeout: Number(process.env.DB_REQUEST_TIMEOUT_MS || 15000),
    pool: {
      min: Number(process.env.DB_POOL_MIN || 0),
      max: Number(process.env.DB_POOL_MAX || 10),
      idleTimeoutMillis: 30000
    },
    options
  };

  if (instanceName) {
    options.instanceName = instanceName;
  } else {
    config.port = Number(process.env.DB_PORT || 1433);
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
      throw new Error('DB_PORT must be a valid TCP port.');
    }
  }

  return config;
}

async function createPool(overrides = {}) {
  const pool = new sql.ConnectionPool(buildConfig(overrides));
  pool.on('error', (error) => {
    console.error('SQL Server connection pool error:', error.message);
  });
  return pool.connect();
}

async function getPool() {
  if (!poolPromise) {
    poolPromise = createPool().catch((error) => {
      poolPromise = undefined;
      throw error;
    });
  }
  return poolPromise;
}

async function closePool() {
  if (!poolPromise) return;
  const pool = await poolPromise.catch(() => null);
  poolPromise = undefined;
  if (pool) await pool.close();
}

module.exports = { sql, buildConfig, createPool, getPool, closePool };
