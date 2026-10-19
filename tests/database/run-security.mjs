import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// Use the pinned devDependency by default; an external tool path is optional.
const moduleSpecifier = process.env.PGLITE_MODULE
  ? pathToFileURL(path.resolve(process.env.PGLITE_MODULE)).href
  : '@electric-sql/pglite';
const { PGlite } = await import(moduleSpecifier);
const db = new PGlite();
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
let stage = 'bootstrap';
try {
  await db.exec(await readFile(path.join(here, 'bootstrap.sql'), 'utf8'));
  const migrationsPath = path.join(root, 'supabase/migrations');
  const migrations = (await readdir(migrationsPath)).filter((name) => name.endsWith('.sql')).sort();
  if (!migrations.length) throw new Error('No database migrations found.');
  let upgradeAssertions = 0;
  for (const migration of migrations) {
    const profileUpgrade = migration === '202610190003_current_profile_names.sql';
    if (profileUpgrade) {
      stage = 'profile upgrade fixtures on existing migrations';
      await db.exec(await readFile(path.join(here, 'profile-upgrade-seed.sql'), 'utf8'));
    }
    stage = `migration ${migration}`;
    await db.exec(await readFile(path.join(migrationsPath, migration), 'utf8'));
    if (profileUpgrade) {
      stage = 'profile upgrade assertions';
      const upgradeResults = await db.exec(await readFile(path.join(here, 'profile-upgrade-assertions.sql'), 'utf8'));
      upgradeAssertions = Number(upgradeResults.flatMap((result) => result.rows ?? [])
        .find((row) => Object.hasOwn(row, 'upgrade_assertions_passed'))?.upgrade_assertions_passed ?? 0);
      if (upgradeAssertions < 7) throw new Error('Profile upgrade assertions did not complete.');
    }
  }
  stage = 'security regression';
  const results = await db.exec(await readFile(path.join(here, 'security-regression.sql'), 'utf8'));
  const summary = results.flatMap((result) => result.rows ?? [])
    .find((row) => Object.hasOwn(row, 'assertions_passed'));
  if (!summary || Number(summary.assertions_passed) < 60) {
    throw new Error('Regression suite did not complete its assertions.');
  }
  console.log(`PASS: migrations applied; ${Number(summary.assertions_passed) + upgradeAssertions} real PostgreSQL assertions passed (${upgradeAssertions} on existing 001/002 data).`);
  console.log('PGlite uses one backend. Multi-connection lock contention is not exercised by this suite.');
} catch (error) {
  console.error(`FAIL during ${stage}: ${error.message}`);
  if (error.detail) console.error(error.detail);
  if (error.where) console.error(error.where);
  process.exitCode = 1;
} finally {
  await db.close();
}
