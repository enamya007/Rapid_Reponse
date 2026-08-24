import { ConfigType, registerAs } from '@nestjs/config';
import { getValidatedEnv } from './env.validation';

export const databaseConfig = registerAs('database', () => {
  const env = getValidatedEnv();

  return {
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    logging: env.DB_LOGGING,
  };
});

export type DatabaseConfig = ConfigType<typeof databaseConfig>;
