import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Skill } from '../../skills/entities/skill.entity';
import { TechnicianProfile } from './technician-profile.entity';

// Many-to-many join table with a payload column (`level`), so it cannot be a plain
// `@ManyToMany`: that would give TypeORM no place to expose `level` on either side.
@Entity('technician_skills')
export class TechnicianSkill {
  @PrimaryColumn({ name: 'technician_profile_id', type: 'uuid' })
  technicianProfileId: string;

  @ManyToOne(() => TechnicianProfile, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'technician_profile_id' })
  technicianProfile: TechnicianProfile;

  @PrimaryColumn({ name: 'skill_id', type: 'uuid' })
  skillId: string;

  @ManyToOne(() => Skill, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'skill_id' })
  skill: Skill;

  // 1 (novice) to 5 (expert), feeds the auto-assignment suggestion score.
  @Column({ type: 'smallint', default: 3 })
  level: number;
}
