import { MigrationInterface, QueryRunner } from 'typeorm';

export class TicketDomain1785254838687 implements MigrationInterface {
  name = 'TicketDomain1785254838687';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "skills" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(80) NOT NULL, "description" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_81f05095507fd84aa2769b4a522" UNIQUE ("name"), CONSTRAINT "PK_0d3212120f4ecedf90864d7e298" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "categories" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(80) NOT NULL, "description" text, "required_skill_id" uuid, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_8b0be371d28245da6e4f4b61878" UNIQUE ("name"), CONSTRAINT "PK_24dbc6126a28ff948da33e97d3b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."ticket_status_enum" AS ENUM('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."ticket_priority_enum" AS ENUM('LOW', 'NORMAL', 'HIGH', 'CRITICAL')`,
    );
    // Backs `tickets.reference` (format "TCK-000123"). A plain sequence, not `serial`/`identity`,
    // because the column's default is a non-trivial expression (prefix + zero-padding), not a
    // bare `nextval()`. `OWNED BY` below ties the sequence's lifecycle to the column, so it is
    // dropped automatically with the table on `down()` instead of being left as an orphan.
    await queryRunner.query(`CREATE SEQUENCE "tickets_reference_seq"`);
    await queryRunner.query(
      `CREATE TABLE "tickets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "reference" character varying(20) NOT NULL DEFAULT 'TCK-' || lpad(nextval('tickets_reference_seq')::text, 6, '0'), "title" character varying(150) NOT NULL, "description" text NOT NULL, "status" "public"."ticket_status_enum" NOT NULL DEFAULT 'OPEN', "priority" "public"."ticket_priority_enum" NOT NULL DEFAULT 'NORMAL', "category_id" uuid NOT NULL, "created_by_id" uuid NOT NULL, "assignee_id" uuid, "site_label" character varying(150), "site_address" text, "sla_due_at" TIMESTAMP WITH TIME ZONE, "assigned_at" TIMESTAMP WITH TIME ZONE, "started_at" TIMESTAMP WITH TIME ZONE, "resolved_at" TIMESTAMP WITH TIME ZONE, "closed_at" TIMESTAMP WITH TIME ZONE, "cancelled_at" TIMESTAMP WITH TIME ZONE, "resolution_note" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_475c055bd3fc3ea3937e312ee2f" UNIQUE ("reference"), CONSTRAINT "PK_343bc942ae261cf7a1377f48fd0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER SEQUENCE "tickets_reference_seq" OWNED BY "tickets"."reference"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_12b901b34113688b4786368510" ON "tickets"  ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1cfb61a749963bfba02395e118" ON "tickets"  ("priority") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f131b2269095005a89841a11e4" ON "tickets"  ("created_by_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dff6e2b44c9b5e177114588772" ON "tickets"  ("assignee_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5f2cc1c61d96a2ceabab5328be" ON "tickets"  ("sla_due_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_09a4d6db964c6b6ce11f8f1d92" ON "tickets"  ("created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tickets_not_deleted" ON "tickets"  ("id") WHERE deleted_at IS NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."comment_visibility_enum" AS ENUM('PUBLIC', 'INTERNAL')`,
    );
    await queryRunner.query(
      `CREATE TABLE "ticket_comments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "ticket_id" uuid NOT NULL, "author_id" uuid, "body" text NOT NULL, "visibility" "public"."comment_visibility_enum" NOT NULL DEFAULT 'PUBLIC', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_811ed3b81dd8df6b9a92058d89c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "attachments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "ticket_id" uuid, "comment_id" uuid, "uploaded_by_id" uuid, "bucket" character varying(100) NOT NULL, "storage_key" character varying(500) NOT NULL, "original_name" character varying(255) NOT NULL, "mime_type" character varying(120) NOT NULL, "size_bytes" bigint NOT NULL, "checksum" character varying(64), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "CHK_attachments_ticket_or_comment" CHECK ("ticket_id" IS NOT NULL OR "comment_id" IS NOT NULL), CONSTRAINT "PK_5e1f050bcff31e3084a1d662412" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "actor_id" uuid, "action" character varying(80) NOT NULL, "entity_type" character varying(60), "entity_id" uuid, "ip_address" inet, "user_agent" character varying(300), "metadata" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_action_created" ON "audit_logs"  ("action", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_actor_created" ON "audit_logs"  ("actor_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "password_reset_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "token_hash" character varying(255) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_d16bebd73e844c48bca50ff8d3d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."notification_type_enum" AS ENUM('TICKET_CREATED', 'TICKET_ASSIGNED', 'TICKET_STATUS_CHANGED', 'TICKET_COMMENTED', 'TICKET_SLA_BREACHED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "recipient_id" uuid NOT NULL, "type" "public"."notification_type_enum" NOT NULL, "ticket_id" uuid, "title" character varying(150) NOT NULL, "body" text NOT NULL, "payload" jsonb, "read_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_recipient_created" ON "notifications"  ("recipient_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_recipient_read" ON "notifications"  ("recipient_id", "read_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "sla_policies" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "priority" "public"."ticket_priority_enum" NOT NULL, "resolution_target_minutes" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_8287eac5c54cc675dc1ae300b9e" UNIQUE ("priority"), CONSTRAINT "PK_41b6803cef982534243a67b6302" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "technician_profiles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "is_available" boolean NOT NULL DEFAULT true, "max_concurrent_tickets" integer NOT NULL DEFAULT '5', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_328f93227e883c577337c6a9551" UNIQUE ("user_id"), CONSTRAINT "REL_328f93227e883c577337c6a955" UNIQUE ("user_id"), CONSTRAINT "PK_b8b333b43558d1423241cb4924e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "technician_skills" ("technician_profile_id" uuid NOT NULL, "skill_id" uuid NOT NULL, "level" smallint NOT NULL DEFAULT '3', CONSTRAINT "PK_a86acf81247e97a4df8d0b7009d" PRIMARY KEY ("technician_profile_id", "skill_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "ticket_assignments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "ticket_id" uuid NOT NULL, "technician_id" uuid NOT NULL, "assigned_by_id" uuid, "reason" text, "is_auto_suggested" boolean NOT NULL DEFAULT false, "assigned_at" TIMESTAMP WITH TIME ZONE NOT NULL, "unassigned_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_02235b218e5aa8feec218f459d2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6e97efccac085b86674d84d069" ON "ticket_assignments"  ("technician_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ticket_assignments_ticket_assigned" ON "ticket_assignments"  ("ticket_id", "assigned_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ticket_status_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "ticket_id" uuid NOT NULL, "from_status" "public"."ticket_status_enum", "to_status" "public"."ticket_status_enum" NOT NULL, "changed_by_id" uuid, "note" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_d989dae9e6078a6d4ce1aca63f7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ticket_status_history_ticket_created" ON "ticket_status_history"  ("ticket_id", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "categories" ADD CONSTRAINT "FK_0e657dce84ece328162a2313ea0" FOREIGN KEY ("required_skill_id") REFERENCES "skills"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tickets" ADD CONSTRAINT "FK_32a7f0e4e32a46a094b55f7c25c" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tickets" ADD CONSTRAINT "FK_f131b2269095005a89841a11e4a" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tickets" ADD CONSTRAINT "FK_dff6e2b44c9b5e177114588772f" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ticket_comments" ADD CONSTRAINT "FK_4ee48e3e18e7c3ac35152a9fb7b" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ticket_comments" ADD CONSTRAINT "FK_580b2a4f5b78b556eb684f96dbe" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "attachments" ADD CONSTRAINT "FK_73d871f247ffebda5dc3f0df8a4" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "attachments" ADD CONSTRAINT "FK_b4b436948b623e8e765bd1c0977" FOREIGN KEY ("comment_id") REFERENCES "ticket_comments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "attachments" ADD CONSTRAINT "FK_70a38fc450d3b433c86b67e69d6" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_177183f29f438c488b5e8510cdb" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "FK_52ac39dd8a28730c63aeb428c9c" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD CONSTRAINT "FK_5332a4daa46fd3f4e6625dd275d" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD CONSTRAINT "FK_d506dd64e3806b61e88a26714e3" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "technician_profiles" ADD CONSTRAINT "FK_328f93227e883c577337c6a9551" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "technician_skills" ADD CONSTRAINT "FK_8f5e1115763dc722111b7c7c0c2" FOREIGN KEY ("technician_profile_id") REFERENCES "technician_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "technician_skills" ADD CONSTRAINT "FK_a38d90b87cbce1636ba44437bf2" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ticket_assignments" ADD CONSTRAINT "FK_1f28749f7471a43f237d79eb7fd" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ticket_assignments" ADD CONSTRAINT "FK_6e97efccac085b86674d84d0690" FOREIGN KEY ("technician_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ticket_assignments" ADD CONSTRAINT "FK_8cbb7a584b222d43179be81108b" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ticket_status_history" ADD CONSTRAINT "FK_52fa10cddeab4cf9d490c387a6c" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ticket_status_history" ADD CONSTRAINT "FK_b30e46a9e8ef7c01564465a30a3" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ticket_status_history" DROP CONSTRAINT "FK_b30e46a9e8ef7c01564465a30a3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ticket_status_history" DROP CONSTRAINT "FK_52fa10cddeab4cf9d490c387a6c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ticket_assignments" DROP CONSTRAINT "FK_8cbb7a584b222d43179be81108b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ticket_assignments" DROP CONSTRAINT "FK_6e97efccac085b86674d84d0690"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ticket_assignments" DROP CONSTRAINT "FK_1f28749f7471a43f237d79eb7fd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "technician_skills" DROP CONSTRAINT "FK_a38d90b87cbce1636ba44437bf2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "technician_skills" DROP CONSTRAINT "FK_8f5e1115763dc722111b7c7c0c2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "technician_profiles" DROP CONSTRAINT "FK_328f93227e883c577337c6a9551"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT "FK_d506dd64e3806b61e88a26714e3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT "FK_5332a4daa46fd3f4e6625dd275d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "password_reset_tokens" DROP CONSTRAINT "FK_52ac39dd8a28730c63aeb428c9c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_177183f29f438c488b5e8510cdb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attachments" DROP CONSTRAINT "FK_70a38fc450d3b433c86b67e69d6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attachments" DROP CONSTRAINT "FK_b4b436948b623e8e765bd1c0977"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attachments" DROP CONSTRAINT "FK_73d871f247ffebda5dc3f0df8a4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ticket_comments" DROP CONSTRAINT "FK_580b2a4f5b78b556eb684f96dbe"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ticket_comments" DROP CONSTRAINT "FK_4ee48e3e18e7c3ac35152a9fb7b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tickets" DROP CONSTRAINT "FK_dff6e2b44c9b5e177114588772f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tickets" DROP CONSTRAINT "FK_f131b2269095005a89841a11e4a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tickets" DROP CONSTRAINT "FK_32a7f0e4e32a46a094b55f7c25c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "categories" DROP CONSTRAINT "FK_0e657dce84ece328162a2313ea0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ticket_status_history_ticket_created"`,
    );
    await queryRunner.query(`DROP TABLE "ticket_status_history"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ticket_assignments_ticket_assigned"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6e97efccac085b86674d84d069"`,
    );
    await queryRunner.query(`DROP TABLE "ticket_assignments"`);
    await queryRunner.query(`DROP TABLE "technician_skills"`);
    await queryRunner.query(`DROP TABLE "technician_profiles"`);
    await queryRunner.query(`DROP TABLE "sla_policies"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_notifications_recipient_read"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_notifications_recipient_created"`,
    );
    await queryRunner.query(`DROP TABLE "notifications"`);
    await queryRunner.query(`DROP TYPE "public"."notification_type_enum"`);
    await queryRunner.query(`DROP TABLE "password_reset_tokens"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_audit_logs_actor_created"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_audit_logs_action_created"`,
    );
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`DROP TABLE "attachments"`);
    await queryRunner.query(`DROP TABLE "ticket_comments"`);
    await queryRunner.query(`DROP TYPE "public"."comment_visibility_enum"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_tickets_not_deleted"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_09a4d6db964c6b6ce11f8f1d92"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5f2cc1c61d96a2ceabab5328be"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dff6e2b44c9b5e177114588772"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f131b2269095005a89841a11e4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1cfb61a749963bfba02395e118"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_12b901b34113688b4786368510"`,
    );
    await queryRunner.query(`DROP TABLE "tickets"`);
    // `tickets_reference_seq` is `OWNED BY "tickets"."reference"`, so dropping the table above
    // already dropped the sequence; `IF EXISTS` keeps this a safe no-op rather than relying
    // silently on that cascade.
    await queryRunner.query(`DROP SEQUENCE IF EXISTS "tickets_reference_seq"`);
    await queryRunner.query(`DROP TYPE "public"."ticket_priority_enum"`);
    await queryRunner.query(`DROP TYPE "public"."ticket_status_enum"`);
    await queryRunner.query(`DROP TABLE "categories"`);
    await queryRunner.query(`DROP TABLE "skills"`);
  }
}
