import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignUserRoles1785249479395 implements MigrationInterface {
  name = 'AlignUserRoles1785249479395';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "first_name" character varying(80)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "last_name" character varying(80)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "phone" character varying(30)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`,
    );

    // Postgres has no `DROP VALUE` / `ADD VALUE ... RENAME` for enums, so the 3-role type is
    // built from scratch: rename the old type out of the way, create the new one, then convert
    // the column across with an explicit `USING` remap.
    //
    // NOTE: the TypeORM CLI's auto-generated `USING "role"::"text"::"public"."user_role_enum"`
    // (the naive cast it produces for an enum column type change) was replaced below with a
    // `CASE` remap. Without it, converting any existing `'USER'` row would fail outright
    // (`'USER'` is not a valid value of the new 3-value enum) instead of becoming `'CLIENT'`.
    await queryRunner.query(
      `ALTER TYPE "public"."user_role_enum" RENAME TO "user_role_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."user_role_enum" AS ENUM('ADMIN', 'TECHNICIAN', 'CLIENT')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`,
    );
    await queryRunner.query(`
      ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."user_role_enum" USING (
        CASE "role"::text
          WHEN 'USER' THEN 'CLIENT'
          ELSE "role"::text
        END
      )::"public"."user_role_enum"
    `);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'CLIENT'`,
    );
    await queryRunner.query(`DROP TYPE "public"."user_role_enum_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse remap: both new roles collapse back onto the old, single `'USER'` value. Any
    // account created or promoted to `TECHNICIAN`/`CLIENT` after this migration ran loses that
    // distinction on revert — inherent to shrinking the enum back down, not a data loss bug.
    await queryRunner.query(
      `ALTER TYPE "public"."user_role_enum" RENAME TO "user_role_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."user_role_enum" AS ENUM('ADMIN', 'USER')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT`,
    );
    await queryRunner.query(`
      ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."user_role_enum" USING (
        CASE "role"::text
          WHEN 'TECHNICIAN' THEN 'USER'
          WHEN 'CLIENT' THEN 'USER'
          ELSE "role"::text
        END
      )::"public"."user_role_enum"
    `);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'USER'`,
    );
    await queryRunner.query(`DROP TYPE "public"."user_role_enum_old"`);

    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "deleted_at"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "phone"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "last_name"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "first_name"`);
  }
}
