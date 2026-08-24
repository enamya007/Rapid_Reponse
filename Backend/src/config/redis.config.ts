import { ConfigType, registerAs } from '@nestjs/config';
import { getValidatedEnv } from './env.validation';

export const redisConfig = registerAs('redis', () => {
  const env = getValidatedEnv();

  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
    // REDIS_DB is optional and stays `undefined` when unset (see
    // env.validation.ts); Redis' own default database index is 0.
    db: env.REDIS_DB ?? 0,
  };
});

export type RedisConfig = ConfigType<typeof redisConfig>;
