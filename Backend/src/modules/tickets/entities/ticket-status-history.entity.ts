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
import { TicketStatus } from '../enums/ticket-status.enum';
import { Ticket } from './ticket.entity';

@Index('IDX_ticket_status_history_ticket_created', ['ticketId', 'createdAt'])
@Entity('ticket_status_history')
export class TicketStatusHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Ticket, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'ticket_id' })
  ticket: Ticket;

  @Column({ name: 'ticket_id', type: 'uuid', nullable: false })
  ticketId: string;

  // `null` for the row created alongside the ticket itself (no previous status).
  @Column({
    name: 'from_status',
    type: 'enum',
    enum: TicketStatus,
    enumName: 'ticket_status_enum',
    nullable: true,
  })
  fromStatus: TicketStatus | null;

  @Column({
    name: 'to_status',
    type: 'enum',
    enum: TicketStatus,
    enumName: 'ticket_status_enum',
    nullable: false,
  })
  toStatus: TicketStatus;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'changed_by_id' })
  changedBy: User | null;

  @Column({ name: 'changed_by_id', type: 'uuid', nullable: true })
  changedById: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
