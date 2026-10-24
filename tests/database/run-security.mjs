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
  let threadUpgradeAssertions = 0;
  for (const migration of migrations) {
    if(migration==='202610240010_retire_cms.sql'){
      stage='historical CMS security checks before retirement';
      await db.exec(await readFile(path.join(here,'cms-regression.sql'),'utf8'));
      const retirement=await readFile(path.join(migrationsPath,migration),'utf8');
      let bucketGuard=false;
      try{await db.exec(retirement)}catch(e){bucketGuard=String(e.message).includes('Storage API/UI first')}
      await db.exec('rollback;');
      if(!bucketGuard)throw new Error('Retirement must wait for Storage API bucket cleanup');
      // In-memory emulation of the separately verified production Storage API deletion.
      await db.exec("delete from storage.buckets where id='cms-media';");
    }
    const profileUpgrade = migration === '202610190003_current_profile_names.sql';
    if (profileUpgrade) {
      stage = 'profile upgrade fixtures on existing migrations';
      await db.exec(await readFile(path.join(here, 'profile-upgrade-seed.sql'), 'utf8'));
    }
    const threadUpgrade = migration === '202610230006_threaded_comments_admin_email.sql';
    if (threadUpgrade) {
      stage = '006 installation checks before migration';
      const before = await db.exec(await readFile(path.join(root, 'supabase/verify_006.sql'), 'utf8'));
      if (before[0]?.rows[0]?.conversation_reader_present !== false || before[0]?.rows[0]?.owner_email_reader_present !== false) {
        throw new Error('006 pre-installation checks did not report missing functions.');
      }
      stage = 'conversation upgrade fixtures on existing 005';
      await db.exec(await readFile(path.join(here, 'thread-upgrade-seed.sql'), 'utf8'));
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
    if (threadUpgrade) {
      stage = 'conversation upgrade assertions';
      const results = await db.exec(await readFile(path.join(here, 'thread-upgrade-assertions.sql'), 'utf8'));
      threadUpgradeAssertions = Number(results.flatMap((result) => result.rows ?? [])
        .find((row) => Object.hasOwn(row, 'thread_upgrade_assertions_passed'))?.thread_upgrade_assertions_passed ?? 0);
      if (threadUpgradeAssertions !== 5) throw new Error('Conversation upgrade assertions did not complete.');
    }
  }
  stage = '006 installation checks after migration';
  const installation = await db.exec(await readFile(path.join(root, 'supabase/verify_006.sql'), 'utf8'));
  if (installation.flatMap(result => result.rows ?? []).some(row => Object.values(row).some(value => value !== true))) {
    throw new Error('006 installation/grant checks failed.');
  }
  stage = 'security regression';
  const results = await db.exec(await readFile(path.join(here, 'security-regression.sql'), 'utf8'));
  const summary = results.flatMap((result) => result.rows ?? [])
    .find((row) => Object.hasOwn(row, 'assertions_passed'));
  if (!summary || Number(summary.assertions_passed) < 60) {
    throw new Error('Regression suite did not complete its assertions.');
  }
  stage = 'avatar storage RLS regression';
  const avatarResults = await db.exec(await readFile(path.join(here, 'avatar-regression.sql'), 'utf8'));
  const avatarAssertions = Number(avatarResults.flatMap((result) => result.rows ?? [])
    .find((row) => Object.hasOwn(row, 'avatar_assertions_passed'))?.avatar_assertions_passed ?? 0);
  if (avatarAssertions < 40) throw new Error('Avatar storage RLS assertions did not complete.');
  stage = 'conversation ordering and private author email regression';
  const threadResults = await db.exec(await readFile(path.join(here, 'thread-regression.sql'), 'utf8'));
  const threadAssertions = Number(threadResults.flatMap((result) => result.rows ?? [])
    .find((row) => Object.hasOwn(row, 'thread_assertions_passed'))?.thread_assertions_passed ?? 0);
  if (threadAssertions < 45) throw new Error('Conversation assertions did not complete.');
  stage = 'anonymous page-view privacy and retry regression';
  const trafficResults = await db.exec(await readFile(path.join(here, 'traffic-regression.sql'), 'utf8'));
  const trafficAssertions = Number(trafficResults.flatMap(result => result.rows ?? []).find(row => Object.hasOwn(row, 'traffic_assertions_passed'))?.traffic_assertions_passed ?? 0);
  if (trafficAssertions < 20) throw new Error('Traffic assertions did not complete.');
  stage = 'legacy CMS retirement isolation';
  await db.exec(await readFile(path.join(here,'cms-retirement.sql'),'utf8'));
  console.log('PASS: legacy CMS removed; comment, avatar and traffic structures retained.');
  console.log(`PASS: migrations applied; ${Number(summary.assertions_passed) + upgradeAssertions + threadUpgradeAssertions + avatarAssertions + threadAssertions + trafficAssertions} real PostgreSQL assertions passed (${upgradeAssertions + threadUpgradeAssertions} on existing data upgrades; ${avatarAssertions} on avatar metadata/RLS; ${threadAssertions} on conversation ordering/email permissions; ${trafficAssertions} on anonymous page views).`);
  console.log('PGlite uses one backend. Multi-connection lock contention is not exercised by this suite.');
  console.log('Avatar tests model Storage metadata only; real JPEG upload, MIME/size enforcement and CDN caching require integration checks.');
} catch (error) {
  console.error(`FAIL during ${stage}: ${error.message}`);
  if (error.detail) console.error(error.detail);
  if (error.where) console.error(error.where);
  process.exitCode = 1;
} finally {
  await db.close();
}
