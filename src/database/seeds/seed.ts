import * as argon2 from 'argon2';
import { ARGON2_OPTIONS } from '../../common/security/password.util';
import { Category } from '../../modules/categories/entities/category.entity';
import { Skill } from '../../modules/skills/entities/skill.entity';
import { SlaPolicy } from '../../modules/sla/entities/sla-policy.entity';
import { TicketPriority } from '../../modules/tickets/enums/ticket-priority.enum';
import { User } from '../../modules/users/entities/user.entity';
import { UserRole } from '../../modules/users/enums/user-role.enum';
import dataSource from '../data-source';

interface AdminSeedInput {
  username: string;
  email: string;
  password: string;
}

function readAdminInputFromEnv(): AdminSeedInput {
  const username = process.env.SEED_ADMIN_USERNAME;
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password) {
    throw new Error('SEED_ADMIN_PASSWORD is required to seed the admin user');
  }
  if (!username) {
    throw new Error('SEED_ADMIN_USERNAME is required to seed the admin user');
  }
  if (!email) {
    throw new Error('SEED_ADMIN_EMAIL is required to seed the admin user');
  }

  return { username, email, password };
}

async function seedAdmin(input: AdminSeedInput): Promise<void> {
  const userRepository = dataSource.getRepository(User);

  const alreadyExists = await userRepository
    .createQueryBuilder('user')
    .where('user.username = :username', { username: input.username })
    .orWhere('user.email = :email', { email: input.email })
    .getExists();

  if (alreadyExists) {
    console.log('Admin user already exists, skipping');
    return;
  }

  const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);

  const admin = userRepository.create({
    username: input.username,
    email: input.email,
    password: passwordHash,
    role: UserRole.ADMIN,
    isActive: true,
  });

  await userRepository.save(admin);
  console.log(`Admin user "${input.username}" created successfully`);
}

// Resolution targets in minutes, one row per priority. Mandatory reference data: the SLA
// due-date calculation (P3+) has nothing to compute from without it.
const SLA_TARGETS: {
  priority: TicketPriority;
  resolutionTargetMinutes: number;
}[] = [
  { priority: TicketPriority.CRITICAL, resolutionTargetMinutes: 240 },
  { priority: TicketPriority.HIGH, resolutionTargetMinutes: 1440 },
  { priority: TicketPriority.NORMAL, resolutionTargetMinutes: 4320 },
  { priority: TicketPriority.LOW, resolutionTargetMinutes: 7200 },
];

async function seedSlaPolicies(): Promise<void> {
  const repository = dataSource.getRepository(SlaPolicy);

  for (const target of SLA_TARGETS) {
    const alreadyExists = await repository.existsBy({
      priority: target.priority,
    });
    if (alreadyExists) {
      continue;
    }
    await repository.save(repository.create(target));
    console.log(`SLA policy for priority "${target.priority}" created`);
  }
}

interface SkillSeedInput {
  name: string;
  description: string;
}

// Starting set for a technical maintenance operation. Business content is kept in French
// (the target users' operating language), unlike the surrounding source code comments.
const SKILLS: SkillSeedInput[] = [
  {
    name: 'Électricité',
    description: 'Installation et réparation des systèmes électriques.',
  },
  {
    name: 'Plomberie',
    description: "Réparation de fuites et de l'alimentation en eau.",
  },
  {
    name: 'Informatique',
    description: 'Support matériel, réseau et logiciel.',
  },
  {
    name: 'Climatisation',
    description: 'Entretien et réparation des systèmes de climatisation.',
  },
  {
    name: 'Serrurerie',
    description: "Serrures, contrôle d'accès et sécurité physique.",
  },
];

async function seedSkills(): Promise<Map<string, string>> {
  const repository = dataSource.getRepository(Skill);
  const idByName = new Map<string, string>();

  for (const input of SKILLS) {
    let skill = await repository.findOneBy({ name: input.name });
    if (!skill) {
      skill = await repository.save(repository.create(input));
      console.log(`Skill "${input.name}" created`);
    }
    idByName.set(input.name, skill.id);
  }

  return idByName;
}

interface CategorySeedInput {
  name: string;
  description: string;
  requiredSkillName: string;
}

const CATEGORIES: CategorySeedInput[] = [
  {
    name: 'Panne électrique',
    description: 'Coupure ou dysfonctionnement électrique.',
    requiredSkillName: 'Électricité',
  },
  {
    name: "Fuite d'eau",
    description: 'Fuite ou panne de plomberie.',
    requiredSkillName: 'Plomberie',
  },
  {
    name: 'Problème informatique',
    description: 'Panne matérielle, réseau ou logicielle.',
    requiredSkillName: 'Informatique',
  },
  {
    name: 'Climatisation en panne',
    description: 'Dysfonctionnement de climatisation ou de chauffage.',
    requiredSkillName: 'Climatisation',
  },
  {
    name: 'Accès et serrurerie',
    description: "Problème de serrure, de badge ou de contrôle d'accès.",
    requiredSkillName: 'Serrurerie',
  },
];

async function seedCategories(
  skillIdByName: Map<string, string>,
): Promise<void> {
  const repository = dataSource.getRepository(Category);

  for (const input of CATEGORIES) {
    const alreadyExists = await repository.existsBy({ name: input.name });
    if (alreadyExists) {
      continue;
    }

    const requiredSkillId = skillIdByName.get(input.requiredSkillName);
    if (!requiredSkillId) {
      throw new Error(
        `Seed error: skill "${input.requiredSkillName}" not found for category "${input.name}"`,
      );
    }

    await repository.save(
      repository.create({
        name: input.name,
        description: input.description,
        requiredSkillId,
      }),
    );
    console.log(`Category "${input.name}" created`);
  }
}

async function main(): Promise<void> {
  const input = readAdminInputFromEnv();

  await dataSource.initialize();
  try {
    await seedAdmin(input);
    await seedSlaPolicies();
    const skillIdByName = await seedSkills();
    await seedCategories(skillIdByName);
  } finally {
    await dataSource.destroy();
  }
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error: unknown) => {
    console.error(
      'Seed failed:',
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  });
