import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DataSource, DataSourceOptions } from 'typeorm';

// Standalone entry point (used by the TypeORM CLI), so it cannot rely on Nest's
// ConfigModule/DI. `dotenv` is only a transitive dependency (pulled in by
// @nestjs/config) and is not resolvable here under pnpm's strict node_modules
// layout. Node's built-in `process.loadEnvFile()` was used previously, but it mutates the
// real OS-level environment table via a native binding, which Jest's `process.env` proxy
// (a disconnected, per-test-file snapshot) never observes. Writing to `process.env` from
// plain JS, as done below, mutates that same proxy and is therefore visible under Jest too.
function loadDotEnv(): void {
  // `__dirname` is `src/database` at runtime (both compiled JS and ts-node/ts-jest), so this
  // resolves to the project root regardless of `process.cwd()`.
  const envPath = resolve(__dirname, '..', '..', '.env');
  if (!existsSync(envPath)) {
    // No .env file found: assume the environment variables are provided directly (CI/prod).
    return;
  }
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    if (key.length === 0 || process.env[key] !== undefined) {
      // Never overrides a variable already present in the environment: the real environment
      // must take precedence over the file, which is standard `.env` loader behaviour.
      continue;
    }
    let value = line.slice(separatorIndex + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
loadDotEnv();

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  logging: process.env.DB_LOGGING === 'true',
  synchronize: false,
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  migrationsTableName: 'migrations',
};

const dataSource = new DataSource(dataSourceOptions);

export default dataSource;
