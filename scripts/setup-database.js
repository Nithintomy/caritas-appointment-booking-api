require('dotenv').config();

const fs = require('node:fs/promises');
const path = require('node:path');
const sql = require('mssql');

const DATABASE_NAME = 'CaritasAppointments';
const DATABASE_DIR = path.join(__dirname, '..', 'database');
const SETUP_LOGIN = process.env.DB_SETUP_USER;
const SETUP_PASSWORD = process.env.DB_SETUP_PASSWORD;
const APP_LOGIN = process.env.DB_USER;
const APP_PASSWORD = process.env.DB_PASSWORD;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function quoteIdentifier(value) {
  return `[${value.replace(/]/g, ']]')}]`;
}

function quoteUnicodeLiteral(value) {
  return `N'${value.replace(/'/g, "''")}'`;
}

function assertConfiguration() {
  if (!SETUP_LOGIN || !SETUP_PASSWORD) {
    throw new Error('DB_SETUP_USER and DB_SETUP_PASSWORD are required. Create the setup login first using database/00_create_logins.sql.');
  }
  if (!APP_LOGIN || !APP_PASSWORD) {
    throw new Error('DB_USER and DB_PASSWORD are required for the application SQL login.');
  }
  if (SETUP_LOGIN.toLowerCase() === APP_LOGIN.toLowerCase()) {
    throw new Error('DB_SETUP_USER and DB_USER must be different. The API must use a separate, restricted login.');
  }
  if (!/^[A-Za-z_][A-Za-z0-9_$#@]{0,127}$/.test(SETUP_LOGIN)) {
    throw new Error('DB_SETUP_USER must be a simple SQL Server login name (letters, numbers, _, $, #, @).');
  }
  if (!/^[A-Za-z_][A-Za-z0-9_$#@]{0,127}$/.test(APP_LOGIN)) {
    throw new Error('DB_USER must be a simple SQL Server login name (letters, numbers, _, $, #, @).');
  }
  if (SETUP_PASSWORD.length < 12 || APP_PASSWORD.length < 12) {
    throw new Error('DB_SETUP_PASSWORD and DB_PASSWORD must each contain at least 12 characters.');
  }
  const databaseName = process.env.DB_NAME || DATABASE_NAME;
  if (databaseName !== DATABASE_NAME) {
    throw new Error(`This assessment setup is fixed to DB_NAME=${DATABASE_NAME}.`);
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the local assessment database setup when NODE_ENV=production.');
  }
}

function toBoolean(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true';
}

function buildConnectionConfig(database, credentials = 'setup') {
  const useSetupLogin = credentials === 'setup';
  const config = {
    server: requiredEnv('DB_SERVER'),
    database,
    user: useSetupLogin ? SETUP_LOGIN : APP_LOGIN,
    password: useSetupLogin ? SETUP_PASSWORD : APP_PASSWORD,
    connectionTimeout: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 15000),
    requestTimeout: Number(process.env.DB_REQUEST_TIMEOUT_MS || 30000),
    pool: { min: 0, max: 3, idleTimeoutMillis: 30000 },
    options: {
      encrypt: toBoolean(process.env.DB_ENCRYPT, false),
      trustServerCertificate: toBoolean(process.env.DB_TRUST_SERVER_CERTIFICATE, true),
      enableArithAbort: true
    }
  };

  const instanceName = process.env.DB_INSTANCE_NAME;
  if (instanceName) {
    if (process.env.DB_PORT) {
      throw new Error('Configure either DB_PORT or DB_INSTANCE_NAME, not both.');
    }
    config.options.instanceName = instanceName;
  } else {
    const port = Number(process.env.DB_PORT || 1433);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('DB_PORT must be a valid TCP port between 1 and 65535.');
    }
    config.port = port;
  }

  return config;
}

function splitSqlBatches(scriptText) {
  // GO is a client-side SQL Server batch separator, not a T-SQL statement.
  return scriptText
    .replace(/^\uFEFF/, '')
    .split(/^\s*GO\s*(?:--.*)?$/gim)
    .map((batch) => batch.trim())
    .filter(Boolean);
}

async function executeSqlFile(pool, fileName) {
  const filePath = path.join(DATABASE_DIR, fileName);
  const scriptText = await fs.readFile(filePath, 'utf8');
  const batches = splitSqlBatches(scriptText);

  for (let index = 0; index < batches.length; index += 1) {
    try {
      await pool.request().batch(batches[index]);
    } catch (error) {
      const wrapped = new Error(`Failed executing ${fileName}, batch ${index + 1}/${batches.length}: ${error.message}`);
      wrapped.cause = error;
      throw wrapped;
    }
  }
  console.log(`  Executed ${fileName} (${batches.length} SQL batch${batches.length === 1 ? '' : 'es'})`);
}

async function createDatabaseIfNeeded() {
  const masterPool = await new sql.ConnectionPool(buildConnectionConfig('master')).connect();
  try {
    await executeSqlFile(masterPool, '01_create_database.sql');
  } finally {
    await masterPool.close();
  }
}

async function provisionApplicationLogin() {
  const masterPool = await new sql.ConnectionPool(buildConnectionConfig('master')).connect();
  const loginIdentifier = quoteIdentifier(APP_LOGIN);
  const loginLiteral = quoteUnicodeLiteral(APP_LOGIN);
  const passwordLiteral = quoteUnicodeLiteral(APP_PASSWORD);

  try {
    await masterPool.request().batch(`
      IF SUSER_ID(${loginLiteral}) IS NULL
      BEGIN
        CREATE LOGIN ${loginIdentifier}
          WITH PASSWORD = ${passwordLiteral}, CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;
      END
      ELSE
      BEGIN
        ALTER LOGIN ${loginIdentifier}
          WITH PASSWORD = ${passwordLiteral}, CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;
      END;
    `);
    console.log(`  Application SQL login [${APP_LOGIN}] is ready`);
  } finally {
    await masterPool.close();
  }
}

async function provisionDatabaseUsers() {
  const databasePool = await new sql.ConnectionPool(buildConnectionConfig(DATABASE_NAME)).connect();
  const setupIdentifier = quoteIdentifier(SETUP_LOGIN);
  const setupLiteral = quoteUnicodeLiteral(SETUP_LOGIN);
  const appIdentifier = quoteIdentifier(APP_LOGIN);
  const appLiteral = quoteUnicodeLiteral(APP_LOGIN);

  try {
    await databasePool.request().batch(`
      DECLARE @setupSid VARBINARY(85) = SUSER_SID(${setupLiteral});
      DECLARE @ownerSid VARBINARY(85) = (SELECT owner_sid FROM sys.databases WHERE database_id = DB_ID());

      IF @setupSid <> @ownerSid
      BEGIN
        IF DATABASE_PRINCIPAL_ID(${setupLiteral}) IS NULL
          CREATE USER ${setupIdentifier} FOR LOGIN ${setupIdentifier};

        IF IS_ROLEMEMBER(N'db_owner', ${setupLiteral}) <> 1
          ALTER ROLE [db_owner] ADD MEMBER ${setupIdentifier};
      END;

      IF DATABASE_PRINCIPAL_ID(${appLiteral}) IS NULL
        CREATE USER ${appIdentifier} FOR LOGIN ${appIdentifier} WITH DEFAULT_SCHEMA = [dbo];
      ELSE
        ALTER USER ${appIdentifier} WITH LOGIN = ${appIdentifier};

      GRANT SELECT ON OBJECT::[dbo].[Doctors] TO ${appIdentifier};
      GRANT SELECT ON OBJECT::[dbo].[Patients] TO ${appIdentifier};
      GRANT SELECT ON OBJECT::[dbo].[AppointmentSlots] TO ${appIdentifier};
      GRANT UPDATE ON OBJECT::[dbo].[AppointmentSlots] TO ${appIdentifier};
      GRANT INSERT ON OBJECT::[dbo].[Appointments] TO ${appIdentifier};
    `);
    console.log(`  Database permissions configured for [${APP_LOGIN}]`);
  } finally {
    await databasePool.close();
  }
}

async function createSchemaAndSeedData() {
  const databasePool = await new sql.ConnectionPool(buildConnectionConfig(DATABASE_NAME)).connect();
  try {
    await executeSqlFile(databasePool, '02_create_tables.sql');
    await executeSqlFile(databasePool, '03_seed_data.sql');
  } finally {
    await databasePool.close();
  }
}

async function verifyApplicationLogin() {
  const appPool = await new sql.ConnectionPool(buildConnectionConfig(DATABASE_NAME, 'app')).connect();
  try {
    const result = await appPool.request().query(`
      SELECT
        DB_NAME() AS DatabaseName,
        USER_NAME() AS DatabaseUser,
        (SELECT COUNT(*) FROM dbo.Doctors) AS DoctorCount,
        (SELECT COUNT(*) FROM dbo.Patients) AS PatientCount,
        (SELECT COUNT(*) FROM dbo.AppointmentSlots) AS SlotCount;
    `);
    const verification = result.recordset[0];
    if (verification.DatabaseName !== DATABASE_NAME) {
      throw new Error('Application login verification connected to an unexpected database.');
    }
    console.log('  Application login connection verified');
    console.log(`  Sample data: ${verification.DoctorCount} doctors, ${verification.PatientCount} patients, ${verification.SlotCount} slots`);
  } finally {
    await appPool.close();
  }
}

async function main() {
  assertConfiguration();
  console.log(`Setting up ${DATABASE_NAME} on ${requiredEnv('DB_SERVER')}...`);
  console.log('This setup is non-destructive: it creates missing objects and sample rows; it does not drop tables or reset bookings.');

  await createDatabaseIfNeeded();
  await provisionApplicationLogin();
  await createSchemaAndSeedData();
  await provisionDatabaseUsers();
  await verifyApplicationLogin();

  console.log(`\nDatabase setup completed successfully: ${DATABASE_NAME}`);
  console.log('Sample booking: SlotId=101, PatientId=5001');
  console.log('Dedicated concurrency test slots: 997, 998 and 999');
}

main().catch((error) => {
  console.error('\nDatabase setup failed:', error.message);
  if (error.cause && error.cause.message) {
    console.error('SQL Server details:', error.cause.message);
  }
  process.exitCode = 1;
});
