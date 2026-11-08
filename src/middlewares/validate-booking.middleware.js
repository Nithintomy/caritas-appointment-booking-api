const HttpError = require('../utils/http-error');

function validateBookingRequest(req, res, next) {
  const body = req.body;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return next(new HttpError(400, 'Request body must be a JSON object.', 'INVALID_REQUEST_BODY'));
  }

  const { slotId, patientId } = body;
  const isPositiveSqlInt = (value) => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;

  if (!isPositiveSqlInt(slotId)) {
    return next(new HttpError(400, 'slotId must be a positive integer.', 'INVALID_SLOT_ID'));
  }

  if (!isPositiveSqlInt(patientId)) {
    return next(new HttpError(400, 'patientId must be a positive integer.', 'INVALID_PATIENT_ID'));
  }

  return next();
}

module.exports = validateBookingRequest;
