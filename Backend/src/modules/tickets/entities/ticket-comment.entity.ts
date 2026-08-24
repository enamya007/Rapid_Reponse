import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { CommentVisibility } from '../enums/comment-visibility.enum';
import { Ticket } from './ticket.entity';

@Entity('ticket_comments')
export class TicketComment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Ticket, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'ticket_id' })
  ticket: Ticket;

  @Column({ name: 'ticket_id', type: 'uuid', nullable: false })
  ticketId: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'author_id' })
  author: User | null;

  @Column({ name: 'author_id', type: 'uuid', nullable: true })
  authorId: string | null;

  @Column({ type: 'text', nullable: false })
  body: string;

  // An INTERNAL comment is never returned to a CLIENT. Filtering happens in the service
  // layer, not the controller.
  @Column({
    type: 'enum',
    enum: CommentVisibility,
    enumName: 'comment_visibility_enum',
    default: CommentVisibility.PUBLIC,
  })
  visibility: CommentVisibility;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
