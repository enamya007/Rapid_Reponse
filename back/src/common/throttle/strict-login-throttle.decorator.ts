import { SetMetadata } from '@nestjs/common';

export const STRICT_LOGIN_THROTTLE_KEY = 'strictLoginThrottle';

/**
 * Marks a route as subject to the dedicated, stricter 'login' named throttler
 * (`THROTTLE_LOGIN_LIMIT` / `THROTTLE_LOGIN_TTL_SECONDS`), on top of — never instead of —
 * the general-purpose 'default' throttler applied to the whole API.
 *
 * The actual numeric limits live in `ThrottlerModule.forRootAsync` (`app.module.ts`), which
 * reads this metadata via the 'login' throttler's `skipIf`: every route WITHOUT this
 * decorator is exempt from the strict limiter, so the rest of the API is never throttled at
 * the brute-force-protection rate. See `AuthController.login`.
 */
export const StrictLoginThrottle = (): MethodDecorator & ClassDecorator =>
  SetMetadata(STRICT_LOGIN_THROTTLE_KEY, true);
