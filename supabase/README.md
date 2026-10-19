# Verified-email comments database

The files in `migrations/` are the database boundary for the static site's
comments. Apply them in filename order as the Supabase migration owner (`postgres`)
using the SQL editor or Supabase migrations. An existing deployment of `001`
only needs `202610190002_comment_parent_author_guard.sql`, which makes the
pending-parent ownership check fail closed when an Auth account was removed.
Do not rerun or edit an already-applied migration. The migrations expect the real Supabase Auth
schemas; **never apply `tests/database/bootstrap.sql` to Supabase**.

## Project setup

1. Enable email/password Auth with **Confirm email** enabled, configure the
   production site URL and exact allowed redirect URLs, and configure the Resend
   SMTP sender for an owned/verified domain. The database independently checks
   `auth.users.email_confirmed_at`; a frontend flag cannot grant posting rights.
2. Apply the migrations in filename order. Keep the API's exposed schemas restricted to the usual
   `public` schema; do not expose `comment_private`. Neither `anon` nor
   `authenticated` has schema usage, table access, or helper-function execution.
   RLS is enabled on private tables with no browser policies.
3. Register the administrator's own account and confirm its email. In the SQL
   editor, look up that account's exact UUID in `auth.users` and insert it into
   the private allowlist. There is no first-registrant administration rule:

   ```sql
   -- Replace this UUID with the account verified in auth.users.
   insert into comment_private.admins (user_id)
   values ('REPLACE-WITH-VERIFIED-ADMIN-UUID'::uuid)
   on conflict do nothing;
   ```

4. Use only the project's public publishable/anon key in the static site. A
   service-role/secret key is unnecessary in the browser and must remain secret.
   Authenticated requests use the Supabase user's access token. Tokens are
   verified by Supabase's API gateway; the RPCs additionally bind `auth.uid()` to
   the token's `session_id` in `auth.sessions`, rejecting missing, revoked,
   mismatched, or expired (`not_after`) sessions. Logging out must use Supabase
   Auth's sign-out API, not merely remove a local UI flag.

## RPC contract

All functions are `SECURITY DEFINER` with an empty `search_path`, fully qualified
private storage references, and explicit execution grants. Only `comment_me`
and `comment_list` allow the anonymous role. Validation failures use SQLSTATE
`P0001` and the fixed message literals below. Bad JSON/UUID syntax and API-level
token validation failures can also be rejected before an RPC executes.

| RPC | Return and behavior |
| --- | --- |
| `comment_me()` | JSON `{nickname,can_post,is_admin,banned,moderation_enabled}`. Anonymous, unconfirmed, or stale sessions receive no identity or privileges. A valid banned account has `banned:true`, `can_post:false`, `is_admin:false`. |
| `comment_list(p_thread,p_before=null,p_before_id=null,p_limit=30)` | Rows `{id,parent_id,nickname,body,created_at,deleted,can_delete,is_admin_author,parent_nickname,parent_deleted,is_pending,author_banned}`. Never returns email, author UUID, IP, or session ID. `author_banned` is null unless the caller is an active admin. |
| `comment_create(p_thread,p_body,p_nickname,p_parent_id=null,p_request_id=null)` | JSON `{id,is_pending}`. A UUID request ID is mandatory; retry the same ID with exactly the same normalized payload. |
| `comment_delete(p_id,p_branch=false)` | Void. Author clears only their own body; banned authors retain this right. Admin can clear any one body or set `p_branch=true` to erase and hide that comment and all descendants in the same thread. |
| `comment_ban(p_comment_id,p_banned)` | Void, admin only. Resolves the author privately from a comment ID. Ban blocks posting using existing tokens; unban restores it. Cannot ban an admin. Existing published comments remain visible. |
| `comment_moderation(p_enabled)` | Void, admin only. Controls whether future non-admin submissions require approval. |
| `comment_review(p_id,p_approve)` | Void, admin only. Approve a pending record after its parent is published, or reject by erasing/hiding the selected branch. Rejection cannot be undone. |

The frontend must display `body` and `nickname` as **plain text**. Do not put them
into `innerHTML`. A deleted row's body is the empty string and should render a
localized deletion placeholder. There is no edit/restore RPC.

## Threads, paging, and replies

Use `/about` for both languages and the canonical `/blog/<slug>` for both language
versions of an article. Thread strings are at most 300 characters; Chinese and
dots in real slugs are allowed. They must have no whitespace/control characters,
query/fragment markers, backslashes, `//`, `.`/`..` path segments, or trailing
slash. This validates route shape, not membership in the static site's article
catalog. URL encoding must be consistent between page languages.

Rows sort by `(created_at DESC, id DESC)`. To fetch the next page, send **both**
fields from the last row as `p_before` and `p_before_id`; limits range from 1 to
100. Reply rows include a visible parent's nickname/deletion state even when
that parent falls outside the current page. The client can show that context
without having fetched the entire discussion. Depth is at most eight replies
below a root. New replies to a deleted or hidden comment are rejected; existing
replies survive an author's deletion.

Soft deletion clears the stored body permanently and keeps only the nickname,
timestamp, relationships, and hashes needed for abuse prevention/idempotency.
Admin branch removal recursively clears bodies and hides the selected branch
from every `comment_list` caller. It does not affect sibling roots or other
threads. Account deletion nulls the private author ID and preserves discussion.

## Moderation visibility

Moderation defaults to **off** (publish immediately). When enabled, future
non-admin submissions are `pending`: visible only to their author and an active
admin. Other users cannot reply to a guessed pending comment ID. A reply to a
pending parent remains pending, including an admin's reply. The parent must be
approved before its child can be approved. Turning moderation off leaves the
existing queue pending. Authors may erase their own pending bodies; approving
such a tombstone never restores the original body. Banned users still see and
can erase their own pending comments but cannot create comments or act as admin.

## Abuse controls and concurrency

The database enforces these explicit rules; it does not claim to detect all
malicious content:

- Body length 1–2000 characters after CRLF/CR normalization and outer ASCII-space
  trimming; whitespace-only text is rejected. Tabs/newlines are allowed inside
  body text; other POSIX control characters are rejected.
- Nicknames contain 1–40 characters after outer ASCII-space trimming and no
  POSIX control characters. A nickname is display text, not proof of identity;
  only the server-provided `is_admin_author` flag identifies the admin.
- At most five occurrences of an HTTP(S) or `www.` link, matched by
  `(https?://|www[.])[^[:space:]]+` case-insensitively. This is a link-count rule,
  not a URL safety filter.
- At most one new comment per 30 seconds and five per rolling ten minutes per
  account, across all threads, including admins. Identical normalized bodies by
  the same account in the same thread within ten minutes are rejected.
  Deleting/hiding does not reset these counters.
- A UUID request ID is unique per account. Same-payload retries return the same
  comment, including after deletion; different payloads fail. Raw bodies are
  never recovered from the retained SHA-256 hashes.

Transaction-scoped advisory locks serialize each account's create/ban operations
before idempotency and rate checks. A session is rechecked after a lock wait.
Per-thread advisory locks serialize create/delete/review tree changes, so a
concurrent reply cannot escape recursive admin removal. The settings row's share
lock serializes a submission's moderation decision with toggles. Hash collisions
only add contention; authorization still uses actual UUIDs and thread strings.
Use one RPC per API transaction; do not manually combine differently ordered
RPCs in long custom transactions. Rate limits are per account, not per IP; Auth
signup limits/CAPTCHA and SMTP provider quotas remain necessary operational
controls against account farming.

## Fixed application errors

`authentication_required`, `email_verification_required`, `session_expired`,
`user_banned`, `admin_required`, `invalid_thread`, `invalid_cursor`,
`invalid_limit`, `invalid_request_id`, `invalid_body`, `invalid_nickname`,
`too_many_links`, `idempotency_conflict`, `duplicate_comment`, `rate_limited`,
`invalid_parent`, `thread_depth_exceeded`, `comment_not_found`, `forbidden`,
`comment_author_missing`, `cannot_ban_admin`, `comment_hidden`, `parent_pending`.

## Run the actual SQL regression

The test creates a fresh in-memory PostgreSQL backend through PGlite. Auth mocks
exist only there. It applies all production migrations in order, changes to actual `anon`
and `authenticated` roles, and runs SQL assertions for grants, private storage,
verified email/session revocation, ownership, banned deletion, recursive removal,
moderation visibility, stable paging, spam limits, and idempotency. Fixtures and
test helpers are rolled back.

From the repository root, use the pinned development dependency:

```sh
npm ci
npm run test:database
```

The test runner also accepts an optional `PGLITE_MODULE` path, for example when
using a separate tool installation in PowerShell:

```powershell
$commentTestTools = Join-Path $env:TEMP ('cyril-comment-db-' + [guid]::NewGuid())
npm.cmd install --prefix $commentTestTools --no-save --package-lock=false --ignore-scripts --proxy=null --https-proxy=null @electric-sql/pglite@0.5.10
$env:PGLITE_MODULE = Join-Path $commentTestTools 'node_modules/@electric-sql/pglite/dist/index.js'
node tests/database/run-security.mjs
```

No production credentials or network are used by the test itself. Alternatively,
in a disposable local PostgreSQL database, run `bootstrap.sql`, all migrations
in filename order and `security-regression.sql` as a
superuser using `psql -v ON_ERROR_STOP=1`.
Do not use these mock/fixture scripts against the production project.

PGlite runs one backend: these tests exercise real SQL, privileges and RPC
behavior but do **not** simulate multiple simultaneous connections, the real
Supabase Auth server, SMTP delivery, or API gateway/JWT verification. The current
production deployment and the remaining real-account acceptance checks are
tracked separately in [COMMENTS-SETUP.md](../COMMENTS-SETUP.md). Public signup
being enabled does not establish that every integration has been verified;
use a staging Supabase project for destructive or multi-account integration tests.
