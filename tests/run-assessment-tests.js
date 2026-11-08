require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { sql, createPool } = require('../src/config/database');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const TEST_SLOT_IDS = [997, 998, 999];
const PATIENT_START = Number(process.env.TEST_PATIENT_ID_START || 9001);
const REQUEST_COUNT_ARG = process.argv.find((arg) => arg.startsWith('--requests='));
const CONCURRENT_REQUESTS = REQUEST_COUNT_ARG
  ? Number(REQUEST_COUNT_ARG.split('=')[1])
  : 50;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function resetTestSlots(pool) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to reset test slots when NODE_ENV=production.');
  }
  if (process.env.ALLOW_TEST_RESET !== 'true') {
    throw new Error('Set ALLOW_TEST_RESET=true in .env to enable reset of test-only slots 997, 998 and 999.');
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    const slotList = TEST_SLOT_IDS.join(','); 
    await new sql.Request(transaction).query(`
      DELETE FROM dbo.Appointments WHERE SlotId IN (${slotList});
      UPDATE dbo.AppointmentSlots SET IsBooked = 0 WHERE SlotId IN (${slotList});
    `);
    const verification = await new sql.Request(transaction).query(`
      SELECT COUNT(*) AS SlotCount
      FROM dbo.AppointmentSlots
      WHERE SlotId IN (${slotList});
    `);
    assert(verification.recordset[0].SlotCount === TEST_SLOT_IDS.length,
      'Expected test slots 997, 998 and 999. Run the database seed script first.');
    await transaction.commit();
  } catch (error) {
    await transaction.rollback().catch(() => {});
    throw error;
  }
}

async function postBooking(payload) {
  const response = await fetch(`${API_BASE_URL}/api/appointments/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  let body;
  try {
    body = await response.json();
  } catch {
    body = { message: 'Response was not valid JSON.' };
  }
  return { status: response.status, body };
}

async function getSlotState(pool, slotId) {
  const result = await pool.request()
    .input('slotId', sql.Int, slotId)
    .query(`
      SELECT s.SlotId, s.IsBooked, COUNT(a.AppointmentId) AS AppointmentCount
      FROM dbo.AppointmentSlots AS s
      LEFT JOIN dbo.Appointments AS a ON a.SlotId = s.SlotId
      WHERE s.SlotId = @slotId
      GROUP BY s.SlotId, s.IsBooked;
    `);
  return result.recordset[0] || null;
}

async function run() {
  assert(Number.isInteger(CONCURRENT_REQUESTS) && CONCURRENT_REQUESTS >= 2 && CONCURRENT_REQUESTS <= 100,
    '--requests must be an integer from 2 to 100.');
  assert(PATIENT_START + CONCURRENT_REQUESTS - 1 <= 9100,
    'Not enough seeded concurrent test patients. Use between 2 and 100 requests.');

  if (!process.env.DB_SETUP_USER || !process.env.DB_SETUP_PASSWORD) {
    throw new Error('DB_SETUP_USER and DB_SETUP_PASSWORD are required for test fixture setup and database verification.');
  }

  const pool = await createPool({
    user: process.env.DB_SETUP_USER,
    password: process.env.DB_SETUP_PASSWORD
  });
  const results = {
    startedAt: new Date().toISOString(),
    apiBaseUrl: API_BASE_URL,
    concurrentRequestCount: CONCURRENT_REQUESTS,
    tests: [],
    databaseVerification: {},
    overall: 'PENDING'
  };

  const record = (name, passed, details) => {
    results.tests.push({ name, passed, details });
    console.log(`${passed ? 'PASS' : 'FAIL'} - ${name}${details ? `: ${details}` : ''}`);
    assert(passed, `Test failed: ${name}${details ? ` (${details})` : ''}`);
  };

  try {
    await resetTestSlots(pool);

    const healthResponse = await fetch(`${API_BASE_URL}/health`);
    record('API health endpoint', healthResponse.status === 200, `HTTP ${healthResponse.status}`);

    const invalidBody = await postBooking({ slotId: 998 });
    record('Reject missing patientId', invalidBody.status === 400, `HTTP ${invalidBody.status}`);

    const invalidSlot = await postBooking({ slotId: 0, patientId: 5001 });
    record('Reject non-positive slotId', invalidSlot.status === 400, `HTTP ${invalidSlot.status}`);

    const missingSlot = await postBooking({ slotId: 999999, patientId: 5001 });
    record('Return 404 for unknown slot', missingSlot.status === 404, `HTTP ${missingSlot.status}`);

    const missingPatient = await postBooking({ slotId: 997, patientId: 999999 });
    record('Return 404 for unknown patient', missingPatient.status === 404, `HTTP ${missingPatient.status}`);
    const unchangedSlot = await getSlotState(pool, 997);
    record('Do not claim slot when patient is missing',
      unchangedSlot && unchangedSlot.IsBooked === false && unchangedSlot.AppointmentCount === 0,
      JSON.stringify(unchangedSlot));

    let rollbackResponse;
    let rollbackState;
    try {
      await pool.request()
        .input('slotId', sql.Int, 997)
        .input('patientId', sql.Int, 5002)
        .query('INSERT INTO dbo.Appointments (SlotId, PatientId) VALUES (@slotId, @patientId);');

      rollbackResponse = await postBooking({ slotId: 997, patientId: 5003 });
      rollbackState = await getSlotState(pool, 997);
      record('Return conflict when appointment INSERT hits the unique constraint',
        rollbackResponse.status === 409, `HTTP ${rollbackResponse.status}`);
      record('Roll back slot claim when appointment INSERT fails',
        rollbackState && rollbackState.IsBooked === false && rollbackState.AppointmentCount === 1,
        JSON.stringify(rollbackState));
    } finally {
      await pool.request()
        .input('slotId', sql.Int, 997)
        .input('patientId', sql.Int, 5002)
        .query(`
          DELETE FROM dbo.Appointments WHERE SlotId = @slotId AND PatientId = @patientId;
          UPDATE dbo.AppointmentSlots SET IsBooked = 0 WHERE SlotId = @slotId;
        `);
    }

    const successfulBooking = await postBooking({ slotId: 998, patientId: 5001 });
    record('Book an available slot', successfulBooking.status === 201, `HTTP ${successfulBooking.status}`);

    const duplicateBooking = await postBooking({ slotId: 998, patientId: 5002 });
    record('Reject an already-booked slot', duplicateBooking.status === 409, `HTTP ${duplicateBooking.status}`);

    const started = performance.now();
    const concurrentResponses = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, (_, index) =>
        postBooking({ slotId: 999, patientId: PATIENT_START + index })
      )
    );
    const durationMs = Math.round(performance.now() - started);
    const statusCounts = concurrentResponses.reduce((counts, item) => {
      counts[item.status] = (counts[item.status] || 0) + 1;
      return counts;
    }, {});

    const successCount = statusCounts[201] || 0;
    const conflictCount = statusCounts[409] || 0;
    const unexpectedCount = concurrentResponses.length - successCount - conflictCount;
    const finalState = await getSlotState(pool, 999);

    results.databaseVerification.concurrentSlot = finalState;
    results.databaseVerification.concurrentDurationMs = durationMs;
    results.databaseVerification.httpStatusCounts = statusCounts;

    record('Concurrent requests: exactly one success', successCount === 1,
      `201 responses=${successCount}; total requests=${CONCURRENT_REQUESTS}`);
    record('Concurrent requests: all other requests conflict',
      conflictCount === CONCURRENT_REQUESTS - 1,
      `409 responses=${conflictCount}; expected=${CONCURRENT_REQUESTS - 1}`);
    record('No unexpected concurrent HTTP responses', unexpectedCount === 0,
      `unexpected responses=${unexpectedCount}`);
    record('Database contains exactly one booking for concurrent slot',
      finalState && finalState.AppointmentCount === 1 && finalState.IsBooked === true,
      JSON.stringify(finalState));

    const finalDuplicate = await postBooking({ slotId: 999, patientId: PATIENT_START });
    record('Subsequent request cannot book the winning slot again',
      finalDuplicate.status === 409, `HTTP ${finalDuplicate.status}`);

    results.finishedAt = new Date().toISOString();
    results.overall = 'PASSED';
  } catch (error) {
    results.finishedAt = new Date().toISOString();
    results.overall = 'FAILED';
    results.error = error.message;
    throw error;
  } finally {
    const outputPath = path.join(__dirname, '..', 'results', 'latest-run.json');
    fs.writeFileSync(outputPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
    console.log(`\nExecution report written to: ${outputPath}`);
    await pool.close();
  }
}

run().catch((error) => {
  console.error('\nAssessment test run failed:', error.message);
  process.exitCode = 1;
});
