import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('password_reset_tokens')
export class PasswordResetToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid', nullable: false })
  userId: string;

  // Never the raw token: only its hash is persisted.
  @Column({ name: 'token_hash', type: 'varchar', length: 255, nullable: false })
  tokenHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: false })
  expiresAt: Date;

  // Single-use: set the first (and only) time the token is redeemed.
  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
