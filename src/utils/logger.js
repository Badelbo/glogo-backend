const winston = require("winston");
const { combine, timestamp, printf, colorize, errors } = winston.format;

const fmt = printf(({ level, message, timestamp, stack }) =>
  `${timestamp} [${level}]: ${stack || message}`
);

const logger = winston.createLogger({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  format: combine(timestamp({ format: "HH:mm:ss" }), errors({ stack: true }), fmt),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), timestamp({ format: "HH:mm:ss" }), fmt)
    }),
  ],
});

module.exports = logger;
