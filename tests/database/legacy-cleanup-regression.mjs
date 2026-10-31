import assert from 'node:assert/strict'
export async function verifyLegacyCleanup(db, source) {
  const cleanup=source.replace(/^begin;$/m,'').replace(/^commit;$/m,'')
  const seed=`insert into comment_private.comments(id,thread,nickname,body,body_hash,created_at,status,depth,request_id,request_hash,deleted_at)
    select ('88000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'/blog/cleanup-fixture','Reader',
      case when n<=19 then '' else 'Keep '||n end,'fixture',now(),'published',0,gen_random_uuid(),'fixture',
      case when n<=19 then now() else null end from generate_series(1,33)n;`
  await db.exec('begin;'+seed)
  const before=await db.query("select jsonb_agg(to_jsonb(c) order by id) as rows from comment_private.comments c where deleted_at is null")
  await db.exec(cleanup)
  const after=await db.query("select jsonb_agg(to_jsonb(c) order by id) as rows from comment_private.comments c where deleted_at is null")
  assert.deepEqual(after.rows,before.rows,'Every surviving record stays byte-for-byte equivalent')
  assert.equal((await db.query("select count(*)::int as n from comment_private.comments where thread='/blog/cleanup-fixture'")).rows[0].n,14)
  await db.exec('rollback;begin;'+seed)
  // A pending child makes its erased parent necessary, changing the approved scope.
  await db.exec("update comment_private.comments set parent_id='88000000-0000-0000-0000-000000000019',depth=1,status='pending' where id='88000000-0000-0000-0000-000000000020';savepoint cleanup_guard;")
  await assert.rejects(db.exec(cleanup),/Scope changed/)
  await db.exec('rollback to savepoint cleanup_guard;')
  assert.equal((await db.query("select count(*)::int as n from comment_private.comments where thread='/blog/cleanup-fixture'")).rows[0].n,33)
  await db.exec('rollback;')
}
