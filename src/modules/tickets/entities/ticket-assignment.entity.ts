import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Ticket } from './ticket.entity';

@Index('IDX_ticket_assignments_ticket_assigned', ['ticketId', 'assignedAt'])
@Entity('ticket_assignments')
export class TicketAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Ticket, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'ticket_id' })
  ticket: Ticket;

  @Column({ name: 'ticket_id', type: 'uuid', nullable: false })
  ticketId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'technician_id' })
  technician: User;

  @Index()
  @Column({ name: 'technician_id', type: 'uuid', nullable: false })
  technicianId: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'assigned_by_id' })
  assignedBy: User | null;

  @Column({ name: 'assigned_by_id', type: 'uuid', nullable: true })
  assignedById: string | null;

  // Mandatory at the service layer when this row records a reassignment, optional for the
  // first assignment of a ticket.
  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'is_auto_suggested', type: 'boolean', default: false })
  isAutoSuggested: boolean;

  @Column({ name: 'assigned_at', type: 'timestamptz', nullable: false })
  assignedAt: Date;

  @Column({ name: 'unassigned_at', type: 'timestamptz', nullable: true })
  unassignedAt: Date | null;
}
