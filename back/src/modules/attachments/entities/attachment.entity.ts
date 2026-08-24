import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TicketComment } from '../../tickets/entities/ticket-comment.entity';
import { Ticket } from '../../tickets/entities/ticket.entity';
import { User } from '../../users/entities/user.entity';

// An attachment always belongs to a ticket, a comment, or both — never neither.
@Check(
  'CHK_attachments_ticket_or_comment',
  '"ticket_id" IS NOT NULL OR "comment_id" IS NOT NULL',
)
@Entity('attachments')
export class Attachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Ticket, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'ticket_id' })
  ticket: Ticket | null;

  @Column({ name: 'ticket_id', type: 'uuid', nullable: true })
  ticketId: string | null;

  @ManyToOne(() => TicketComment, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'comment_id' })
  comment: TicketComment | null;

  @Column({ name: 'comment_id', type: 'uuid', nullable: true })
  commentId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'uploaded_by_id' })
  uploadedBy: User | null;

  @Column({ name: 'uploaded_by_id', type: 'uuid', nullable: true })
  uploadedById: string | null;

  @Column({ type: 'varchar', length: 100, nullable: false })
  bucket: string;

  @Column({
    name: 'storage_key',
    type: 'varchar',
    length: 500,
    nullable: false,
  })
  storageKey: string;

  @Column({
    name: 'original_name',
    type: 'varchar',
    length: 255,
    nullable: false,
  })
  originalName: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 120, nullable: false })
  mimeType: string;

  // Kept as a string: JS `number` cannot safely represent the full `bigint` range, and the
  // Postgres driver returns `bigint` columns as strings by default.
  @Column({ name: 'size_bytes', type: 'bigint', nullable: false })
  sizeBytes: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  checksum: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
