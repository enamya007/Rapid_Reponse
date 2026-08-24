import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Skill } from '../../skills/entities/skill.entity';

@Entity('categories')
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 80, unique: true, nullable: false })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  // Pivot of the automatic assignment suggestion: category -> required skill -> technicians
  // who hold it.
  @ManyToOne(() => Skill, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'required_skill_id' })
  requiredSkill: Skill | null;

  @Column({ name: 'required_skill_id', type: 'uuid', nullable: true })
  requiredSkillId: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
