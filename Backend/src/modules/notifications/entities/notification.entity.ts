import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Ticket } from '../../tickets/entities/ticket.entity';
import { User } from '../../users/entities/user.entity';
import { NotificationType } from '../enums/notification-type.enum';

@Index('IDX_notifications_recipient_read', ['recipientId', 'readAt'])
@Index('IDX_notifications_recipient_created', ['recipientId', 'createdAt'])
@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'recipient_id' })
  recipient: User;

  @Column({ name: 'recipient_id', type: 'uuid', nullable: false })
  recipientId: string;

  @Column({
    type: 'enum',
    enum: NotificationType,
    enumName: 'notification_type_enum',
    nullable: false,
  })
  type: NotificationType;

  @ManyToOne(() => Ticket, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'ticket_id' })
  ticket: Ticket | null;

  @Column({ name: 'ticket_id', type: 'uuid', nullable: true })
  ticketId: string | null;

  @Column({ type: 'varchar', length: 150, nullable: false })
  title: string;

  @Column({ type: 'text', nullable: false })
  body: string;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
