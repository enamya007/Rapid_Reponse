import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('refresh_tokens')
export class RefreshToken {
  // Also serves as the `jti` claim embedded in the refresh JWT.
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index()
  @Column({ name: 'user_id', type: 'uuid', nullable: false })
  userId: string;

  // Argon2id hash of the refresh JWT. The raw token itself is never persisted.
  @Column({ name: 'token_hash', type: 'varchar', length: 255, nullable: false })
  tokenHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: false })
  expiresAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
