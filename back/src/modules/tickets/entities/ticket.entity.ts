import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Category } from '../../categories/entities/category.entity';
import { User } from '../../users/entities/user.entity';
import { TicketPriority } from '../enums/ticket-priority.enum';
import { TicketStatus } from '../enums/ticket-status.enum';

// Partial index backing the "list active tickets" queries that every filter/listing endpoint
// runs (soft-deleted tickets are excluded almost everywhere): keeps that predicate off a full
// table scan without growing the index to cover rows nobody queries once deleted.
@Index('IDX_tickets_not_deleted', ['id'], { where: 'deleted_at IS NULL' })
@Entity('tickets')
export class Ticket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Generated exclusively by the `tickets_reference_seq` Postgres sequence (created in the
  // `TicketDomain` migration) through this raw SQL default, never in application code: two
  // concurrent inserts must never be able to race for the same human-readable reference.
  // `insert`/`update` are disabled so TypeORM never attempts to write a client-supplied value.
  @Column({
    type: 'varchar',
    length: 20,
    unique: true,
    insert: false,
    update: false,
    default: () =>
      "('TCK-'|| lpad((nextval('tickets_reference_seq')), 6, '0'))",
  })
  reference: string;

  @Column({ type: 'varchar', length: 150, nullable: false })
  title: string;

  @Column({ type: 'text', nullable: false })
  description: string;

  @Index()
  @Column({
    type: 'enum',
    enum: TicketStatus,
    enumName: 'ticket_status_enum',
    default: TicketStatus.OPEN,
  })
  status: TicketStatus;

  @Index()
  @Column({
    type: 'enum',
    enum: TicketPriority,
    enumName: 'ticket_priority_enum',
    default: TicketPriority.NORMAL,
  })
  priority: TicketPriority;

  @ManyToOne(() => Category, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'category_id' })
  category: Category;

  @Column({ name: 'category_id', type: 'uuid', nullable: false })
  categoryId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User;

  @Index()
  @Column({ name: 'created_by_id', type: 'uuid', nullable: false })
  createdById: string;

  // Denormalized copy of the currently assigned technician: avoids a join on
  // `ticket_assignments` for the most frequent filter in the app ("my tickets" /
  // "unassigned tickets"). `ticket_assignments` remains the source of truth for the
  // assignment history.
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'assignee_id' })
  assignee: User | null;

  @Index()
  @Column({ name: 'assignee_id', type: 'uuid', nullable: true })
  assigneeId: string | null;

  @Column({
    name: 'site_label',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  siteLabel: string | null;

  @Column({ name: 'site_address', type: 'text', nullable: true })
  siteAddress: string | null;

  @Index()
  @Column({ name: 'sla_due_at', type: 'timestamptz', nullable: true })
  slaDueAt: Date | null;

  // The five transition timestamps below are what makes delay statistics computable without
  // replaying the full `ticket_status_history`.
  @Column({ name: 'assigned_at', type: 'timestamptz', nullable: true })
  assignedAt: Date | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote: string | null;

  @Index()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
