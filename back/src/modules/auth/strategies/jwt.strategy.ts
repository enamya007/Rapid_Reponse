import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { jwtConfig } from '../../../config/jwt.config';
import type { JwtConfig } from '../../../config/jwt.config';
import { User } from '../../users/entities/user.entity';
import { UsersService } from '../../users/users.service';
import { JwtPayload } from '../types/jwt-payload.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @Inject(jwtConfig.KEY) config: JwtConfig,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.accessSecret,
      ignoreExpiration: false,
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    const user = await this.usersService.findById(payload.sub);

    // A structurally valid, unexpired JWT must not survive the account being deleted or
    // disabled after it was issued.
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    return user;
  }
}
