const { sql, getPool } = require('../config/database');
const HttpError = require('../utils/http-error');

const DUPLICATE_KEY_ERROR_NUMBERS = new Set([2601, 2627]);

async function bookAppointment({ slotId, patientId }) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  let transactionStarted = false;

  try {
    await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
    transactionStarted = true;

    const patientResult = await new sql.Request(transaction)
      .input('patientId', sql.Int, patientId)
      .query(`
        SELECT PatientId
        FROM dbo.Patients
        WHERE PatientId = @patientId;
      `);

    if (patientResult.recordset.length === 0) {
      throw new HttpError(404, 'Patient does not exist.', 'PATIENT_NOT_FOUND');
    }

    const claimResult = await new sql.Request(transaction)
      .input('slotId', sql.Int, slotId)
      .query(`
        UPDATE dbo.AppointmentSlots
        SET IsBooked = 1
        OUTPUT INSERTED.SlotId
        WHERE SlotId = @slotId
          AND IsBooked = 0;
      `);

    if (claimResult.recordset.length === 0) {
      const slotResult = await new sql.Request(transaction)
        .input('slotId', sql.Int, slotId)
        .query(`
          SELECT SlotId
          FROM dbo.AppointmentSlots
          WHERE SlotId = @slotId;
        `);

      if (slotResult.recordset.length === 0) {
        throw new HttpError(404, 'Appointment slot does not exist.', 'SLOT_NOT_FOUND');
      }

      throw new HttpError(409, 'This appointment slot is already booked.', 'SLOT_ALREADY_BOOKED');
    }

    const appointmentResult = await new sql.Request(transaction)
      .input('slotId', sql.Int, slotId)
      .input('patientId', sql.Int, patientId)
      .query(`
        INSERT INTO dbo.Appointments (SlotId, PatientId)
        OUTPUT
          INSERTED.AppointmentId,
          INSERTED.SlotId,
          INSERTED.PatientId,
          INSERTED.BookedAt
        VALUES (@slotId, @patientId);
      `);

    const appointment = appointmentResult.recordset[0];
    await transaction.commit();
    transactionStarted = false;

    return {
      appointmentId: appointment.AppointmentId,
      slotId: appointment.SlotId,
      patientId: appointment.PatientId,
      bookedAt: appointment.BookedAt
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        console.error('Transaction rollback failed:', rollbackError.message);
      }
    }

    if (DUPLICATE_KEY_ERROR_NUMBERS.has(error.number)) {
      throw new HttpError(409, 'This appointment slot is already booked.', 'SLOT_ALREADY_BOOKED');
    }

    throw error;
  }
}

module.exports = { bookAppointment };
