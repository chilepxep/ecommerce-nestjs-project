import * as winston from 'winston';
import { utilities as nestWinstonModuleUtilities } from 'nest-winston';

const { combine, timestamp, printf, colorize } = winston.format;

// Custom format cho production logs
const productionFormat = combine(
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  printf(({ level, message, timestamp, context, trace, ...meta }) => {
    return JSON.stringify({
      timestamp,
      level,
      context,
      message,
      ...(trace ? { trace } : {}),
      ...(Object.keys(meta).length && { meta }),
    });
  }),
);

// Format đẹp cho development
const developmentFormat = combine(
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  nestWinstonModuleUtilities.format.nestLike('EcommerceAPI', {
    prettyPrint: true,
    colors: true,
  }),
);

const isDev = process.env.NODE_ENV !== 'production';

export const winstonConfig = {
  transports: [
    // Console log
    new winston.transports.Console({
      format: isDev ? developmentFormat : productionFormat,
    }),
    // File log - errors
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: productionFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
    // File log - combined
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: productionFormat,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 10,
    }),
  ],
};
