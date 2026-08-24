import { ConfigType, registerAs } from '@nestjs/config';
import { getValidatedEnv } from './env.validation';

export const throttleConfig = registerAs('throttle', () => {
  const env = getValidatedEnv();

  return {
    ttlSeconds: env.THROTTLE_TTL_SECONDS,
    limit: env.THROTTLE_LIMIT,
    login: {
      ttlSeconds: env.THROTTLE_LOGIN_TTL_SECONDS,
      limit: env.THROTTLE_LOGIN_LIMIT,
    },
  };
});

export type ThrottleConfig = ConfigType<typeof throttleConfig>;
