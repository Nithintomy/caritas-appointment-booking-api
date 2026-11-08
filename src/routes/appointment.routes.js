const express = require('express');
const appointmentController = require('../controllers/appointment.controller');
const validateBookingRequest = require('../middlewares/validate-booking.middleware');

const router = express.Router();

router.post('/book', validateBookingRequest, appointmentController.bookAppointment);

module.exports = router;
