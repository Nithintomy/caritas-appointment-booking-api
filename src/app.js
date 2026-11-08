const express = require('express');
const helmet = require('helmet');
const appointmentRoutes = require('./routes/appointment.routes');
const errorHandler = require('./middlewares/error.middleware');
const HttpError = require('./utils/http-error');

const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '10kb', strict: true }));

app.get('/health', (req, res) => {
  res.status(200).json({ success: true, status: 'ok' });
});

app.use('/api/appointments', appointmentRoutes);

app.use((req, res, next) => {
  next(new HttpError(404, 'Route not found.', 'ROUTE_NOT_FOUND'));
});

app.use(errorHandler);

module.exports = app;
