const appointmentService = require('../services/appointment.service');

async function bookAppointment(req, res, next) {
  try {
    const appointment = await appointmentService.bookAppointment(req.body);
    return res.status(201).json({
      success: true,
      message: 'Appointment booked successfully.',
      data: appointment
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { bookAppointment };
