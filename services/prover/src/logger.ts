import pino from 'pino';

const parseLogLevel = (): pino.LevelWithSilent => {
  const raw = (
    process.env.DARKWALLET_LOG_LEVEL ??
    process.env.MIDLIGHT_LOG_LEVEL ??
    process.env.LOG_LEVEL ??
    'info'
  )
    .trim()
    .toLowerCase();

  const validLevels: pino.LevelWithSilent[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];
  return validLevels.includes(raw as pino.LevelWithSilent) ? (raw as pino.LevelWithSilent) : 'info';
};

export const logger = pino({
  level: parseLogLevel(),
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: 'darkwallet-prover',
  },
});

