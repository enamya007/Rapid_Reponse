import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TicketPriority } from '../../tickets/enums/ticket-priority.enum';

@Entity('sla_policies')
export class SlaPolicy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: TicketPriority,
    enumName: 'ticket_priority_enum',
    unique: true,
  })
  priority: TicketPriority;

  @Column({ name: 'resolution_target_minutes', type: 'int', nullable: false })
  resolutionTargetMinutes: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
