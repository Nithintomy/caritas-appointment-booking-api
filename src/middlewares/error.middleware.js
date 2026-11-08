function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  let statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  let message = statusCode === 500
    ? 'An unexpected error occurred while processing the request.'
    : error.message;

  if (error.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'Request body contains invalid JSON.';
  } else if (error.type === 'entity.too.large') {
    statusCode = 413;
    message = 'Request body is too large.';
  }

  if (statusCode >= 500) {
    console.error('Unhandled API error:', {
      name: error.name,
      message: error.message,
      number: error.number,
      code: error.code
    });
  }

  return res.status(statusCode).json({
    success: false,
    message,
    ...(error.code && statusCode < 500 ? { code: error.code } : {})
  });
}

module.exports = errorHandler;
