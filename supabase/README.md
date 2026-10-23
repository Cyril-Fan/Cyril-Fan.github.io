# Verified-email comments database

The files in `migrations/` are the database boundary for the static site's
comments. Apply them in filename order as the Supabase migration owner (`postgres`)
using the SQL editor or Supabase migrations. An existing deployment of `001`
needs `202610190002_comment_parent_author_guard.sql`, which makes the
pending-parent ownership check fail closed when an Auth account was removed,
then `202610190003_current_profile_names.sql`. A deployment already on `002`
needs `003`, which adds current profile names and an authenticated rename RPC,
then `202610190004_admin_posting_frequency.sql`. A deployment already on `003`
needs `004`, which exempts verified administrators from the two posting
frequency limits while preserving all other validation, then
`202610190005_profile_avatars.sql`. A deployment on `004` needs only `005`,
which adds ordinary-user avatar slots, the dedicated Storage bucket and its
ownership policies, and current avatar fields on the comment RPCs.
An existing deployment on `005` next needs
`202610230006_threaded_comments_admin_email.sql`. This adds two read-only RPCs;
it does not rewrite comments, profiles, administrator membership, or the legacy
`comment_list`. Apply `006` before publishing the frontend that calls the new
conversation reader. Existing browser tabs can keep using the old reader.
Do not rerun or edit an already-applied migration. The migrations expect the real Supabase Auth
and Storage schemas; **never apply `tests/database/bootstrap.sql` to Supabase**.

### Deploying 006 to the existing site

1. Select the existing Supabase project `qztlbyahaabkedmvlxwu` in the SQL Editor.
   Confirm that migrations through `005` are present. Run the read-only checks in
   `verify_006.sql`; the two new-function checks are false before installation.
2. Run the complete contents of
   `migrations/202610230006_threaded_comments_admin_email.sql` once as the existing
   database migration owner. It is one transaction with an explicit schema-cache
   notification. It creates only the two new functions and their execution grants;
   there is no data rewrite, account creation, administrator grant, or table policy
   change. Do not paste any local test bootstrap or fixture into the real project.
3. Run `verify_006.sql` again. All function/grant/privacy checks must be true. The
   check impersonates no account and returns no comment text or author email.
4. Only after that succeeds, publish the matching frontend. The old `comment_list`
   and existing comments remain available to older browser tabs. A frontend rollback
   can continue using `comment_list` without removing the new database functions.
5. With the existing owner session, open an author's menu and request its email;
   verify that sign-out removes it. In a separate ordinary/anonymous session, verify
   that no email menu exists, list responses contain no email, and a direct call to
   the email RPC is rejected. Use existing comments; no production test posts are
   necessary. The SQL Editor runs as the database owner, so its grant checks do not
   replace these authenticated API checks.

Local migration tests cover old `005` data, reply order and pagination, deleted and
unavailable originals, all existing authorization checks, and the new private-email
RPC. They do not establish that `006` has been applied to the production project.

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
and the two list readers allow the anonymous role. Validation failures use SQLSTATE
`P0001` and the fixed message literals below. Bad JSON/UUID syntax and API-level
token validation failures can also be rejected before an RPC executes.

| RPC | Return and behavior |
| --- | --- |
| `comment_me()` | JSON `{nickname,can_post,is_admin,banned,moderation_enabled,avatar_key,avatar_path}`. Anonymous, unconfirmed, or stale sessions receive no identity or privileges, including null avatar fields. A valid banned account has `banned:true`, `can_post:false`, `is_admin:false` and retains its own avatar fields for removal. Administrator names are always `Cyril Fan`, including before their first post; their avatar fields are null because the frontend uses the site's fixed portrait. |
| `comment_profile_update(p_nickname)` | Same JSON as `comment_me`. Requires the caller's verified, active, unbanned session. Updates only that caller's profile; a user ID cannot be supplied. Admin input is ignored in favor of `Cyril Fan`. |
| `comment_list(p_thread,p_before=null,p_before_id=null,p_limit=30)` | Rows `{id,parent_id,nickname,body,created_at,deleted,can_delete,is_admin_author,parent_nickname,parent_deleted,is_pending,author_banned,avatar_path}`. Comment and parent names use current profiles, including historical comments and deletion placeholders. The avatar path also follows the current profile/object, and is null for administrators, missing objects and banned authors. Never returns email, author UUID, IP, or session ID. `author_banned` is null unless the caller is an active admin. |
| `comment_thread_list(p_thread,p_after_id=null,p_limit=30,p_focus_id=null)` | JSON array with the same public comment fields plus `{root_id,root_created_at,root_unavailable}`. Original comments sort newest first; every reply in the same conversation, including replies to replies, follows its original in chronological order with an ID tie-breaker. Normal calls return at most `p_limit` individual comments (1–100), never an unbounded tree. The last normal-page comment ID continues the stream. Optional focus mode returns only the requested visible comment and its visible original/anchor (at most two rows; limit must be at least two), with `gap_before` indicating visible replies omitted between the normal cursor and target. It never changes the normal paging cursor. An unavailable original is replaced by an anchor derived only from a visible comment; its private fields and invisible parent IDs are omitted. Email is never returned, even to the owner. |
| `comment_author_email(p_thread,p_comment_id)` | Current author email or null for an unavailable account. Requires the verified, active, unbanned administrator session before looking up the comment. Only comments in the requested article that have not been hidden are eligible. Anonymous execution is revoked; ordinary authenticated users are rejected by `require_actor(true)`. No email snapshot is stored in comment tables. The frontend calls this only from the owner's “View author email” menu, keeps the result in page memory, and clears it when refreshing, signing out, changing accounts, losing permissions or disconnecting. |
| `comment_create(p_thread,p_body,p_nickname,p_parent_id=null,p_request_id=null)` | JSON `{id,is_pending}`. A UUID request ID is mandatory; retry the same ID with exactly the same normalized thread, body, and parent. Nickname is mutable metadata and does not affect retries. An existing profile wins over a stale form; the supplied name initializes a missing profile. Admins may omit the nickname value (`null`) and always publish as `Cyril Fan`. |
| `comment_delete(p_id,p_branch=false)` | Void. Author clears only their own body; banned authors retain this right. Admin can clear any one body or set `p_branch=true` to erase and hide that comment and all descendants in the same thread. |
| `comment_ban(p_comment_id,p_banned)` | Void, admin only. Resolves the author privately from a comment ID. Ban blocks posting using existing tokens; unban restores it. Cannot ban an admin. Existing published comments remain visible. |
| `comment_moderation(p_enabled)` | Void, admin only. Controls whether future non-admin submissions require approval. |
| `comment_review(p_id,p_approve)` | Void, admin only. Approve a pending record after its parent is published, or reject by erasing/hiding the selected branch. Rejection cannot be undone. |
| `comment_avatar_is_owner(p_name,p_allow_banned=false)` | Boolean Storage-policy helper, authenticated role only. Checks the current verified session against the caller's private profile and exact fixed object name. `true` for the second argument permits a banned author to read/remove their own avatar; INSERT/UPDATE policies always use `false`. It never grants access by nickname, email, Auth metadata or Storage `owner_id`. The frontend need not call it. |

The frontend must display `nickname` as **plain text** and pass `body` only through
the site's audited Markdown sanitization/rendering pipeline. Never insert raw
comment content through `innerHTML`. A deleted row's body is the empty string and should render a
localized deletion placeholder. There is no edit/restore RPC.

## Display names

A visitor chooses a nickname once, either through `comment_profile_update` or
their first `comment_create`. Subsequent name edits use `comment_profile_update`;
posting from an old tab cannot overwrite a more recent rename. The next list
read shows the new name on that account's comments across all threads and on
other people's reply labels, even if the parent is outside the loaded page.
Clients should refresh the already-loaded comments after saving a name.

The administrator's display name is enforced as `Cyril Fan` by the database,
regardless of any earlier saved profile. Nicknames are not unique. Another
visitor using the same text never acquires `is_admin_author` or any permission;
only the server-provided badge establishes administrator identity.

Comment rows retain their original nickname snapshot. It is used only when the
profile/account no longer exists and for validating retries of pre-`003`
requests. A renamed profile is not a comment content edit, does not restore
erased bodies, and cannot reset posting limits. After account deletion, the
original name snapshot remains with the discussion; it is not anonymized by
this implementation.

## Profile avatars and Storage

Migration `005` gives each existing/new profile a unique random `avatar_key`.
The user must first save a nickname or post their first comment to create a
profile; there is no automatic nickname or avatar-key-creation endpoint.
`comment_me` returns the current ordinary user's own key. Upload only
`<avatar_key>.jpg` to the public `comment-avatars` bucket with content type
`image/jpeg`, `upsert:true` and a short `cacheControl` such as `60`. The bucket
declares a 131072-byte (128 KiB) maximum and JPEG-only MIME type. Browser resizing
and JPEG re-encoding are a convenience, not a server guarantee about actual file
contents; Storage enforces its configured MIME/size rules, not image moderation.

The bucket has separate SELECT/INSERT/UPDATE/DELETE policies. A verified account
with a live matching session can operate only on its own exact filename.
INSERT/UPDATE also require an unbanned ordinary account. SELECT/DELETE retain
the author's removal right while banned. Administrator accounts use the fixed
site portrait and cannot upload a separate comment avatar, even if they have an
older private profile. Other buckets, filenames, folders and other accounts'
objects are outside these policies. Keep any other Storage policies scoped to
their own buckets: PostgreSQL combines permissive policies with OR.

Supabase upsert needs SELECT, INSERT and UPDATE, so SELECT is granted only for
the caller's own object. No anonymous listing policy is added. Public image
delivery uses the bucket's public endpoint and does not require opening the
object metadata listing. Policy details are based on the official
[Storage access-control guide](https://supabase.com/docs/guides/storage/security/access-control)
and [bucket configuration guide](https://supabase.com/docs/guides/storage/buckets/creating-buckets).

`avatar_path` is `<avatar_key>.jpg?v=<updated_at epoch microseconds>`, or null
when no object exists. Build its URL using the configured Supabase project's
public Storage endpoint. Paths contain a random public avatar token, never an
account UUID, email or email hash. A public avatar token is not a secret or an
authorization credential; knowing it never grants write access. The version
query changes after an overwrite, and all historical comments use the current
object on their next list refresh. Deleting the object through the Storage API
returns those comments to the default avatar. Replacing an avatar uses one slot
instead of accumulating files under new names.

Both site bans and native Auth bans suppress an author's `avatar_path` in
comment lists. This hides it in the site UI; it does not revoke an already-known
public image URL. Removal through Storage is necessary to delete the file, and
previous browser/CDN copies can persist until expiry. Removing an Auth account
cascades its private profile and stops avatar references in comment lists, but
does not delete the Storage blob: record its opaque key privately and remove it
through the Storage API or dashboard as part of account cleanup. Do not delete
only the `storage.objects` SQL row, which can leave an untracked blob. Never
place such private account-to-object mappings in the public repository.

## Threads, paging, and replies

Use `/about` and `/links` for their respective bilingual discussions, and the canonical `/blog/<slug>` for both language
versions of an article. Thread strings are at most 300 characters; Chinese and
dots in real slugs are allowed. They must have no whitespace/control characters,
query/fragment markers, backslashes, `//`, `.`/`..` path segments, or trailing
slash. This validates route shape, not membership in the static site's article
catalog. URL encoding must be consistent between page languages.

Migration `202610230007_links_discussion.sql` adds `/links` to the existing route
validator. Apply it before publishing the links page with comments. It does not
change RPC grants, authentication, rate limits, moderation or author-email access.

The legacy `comment_list` rows sort by `(created_at DESC, id DESC)`. To fetch the next page, send **both**
fields from the last row as `p_before` and `p_before_id`; limits range from 1 to
100. Reply rows include a visible parent's nickname/deletion state even when
that parent falls outside the current page. The client can show that context
without having fetched the entire discussion. Depth is at most eight replies
below a root. New replies to a deleted or hidden comment are rejected; existing
replies survive an author's deletion.

The current frontend uses `comment_thread_list`. It groups all loaded replies
under their original, with only one level of visual indentation and a link to
the actual replied-to comment when it is loaded. A 30-comment response can end
partway through a conversation; “Load more comments and replies” continues that
same conversation before moving to the next original. New replies do not bump
an old original above newer originals. Times use the reader's local time zone
and the `h23` hour cycle in both languages (00:00–23:59).

After an acknowledged post, the frontend refreshes the loaded pages. If the new
comment lies beyond those pages, one focus read fetches only that comment and its
original/visible anchor, then scrolls to the submitted comment. An explicit gap
notice offers to load omitted replies; subsequent pages still continue from the
last normal-page cursor, so intermediate comments are not skipped. The frontend
does not automatically fetch an unbounded number of pages. If the focus read
fails, the message confirms the successful submission and asks the reader to
refresh or load more, without submitting again. Account changes discard late
focus responses, including private pending comments.

If a cursor is no longer visible after moderation, the frontend refreshes the
loaded pages instead of appending a page from an invalid position. A former
administrator can retain visibility of their own pending replies beneath an
invisible original: the reader groups those visible replies under a neutral
placeholder using only a visible comment's ID and timestamp. It never exposes
the unavailable original's content, author, timestamp or count of hidden replies.

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
- Nicknames contain 1–40 characters after outer ASCII-space trimming, contain a
  non-whitespace character, and contain no POSIX control characters. A nickname is display text, not proof of identity;
  only the server-provided `is_admin_author` flag identifies the admin.
- At most five occurrences of an HTTP(S) or `www.` link, matched by
  `(https?://|www[.])[^[:space:]]+` case-insensitively. This is a link-count rule,
  not a URL safety filter.
- Ordinary accounts may create at most one new comment per 30 seconds and five
  per rolling ten minutes, across all threads. Active, verified administrators
  in the private allowlist are exempt from these two frequency limits. Nicknames
  and Auth metadata cannot grant the exemption; removal from the allowlist
  immediately restores the limits, counting that account's existing posts.
  Deleting/hiding does not reset these counters.
- Identical normalized bodies by the same account in the same thread within ten
  minutes are rejected, including for administrators. Administrator posting
  still requires a verified email, live session and unbanned account, and keeps
  all body, link, reply and idempotency validation.
- A UUID request ID is unique per account. Retries with the same normalized
  thread/body/parent return the same comment, including after deletion and name
  changes; a changed thread/body/parent fails. New hashes use version `2`, which
  excludes nickname. Existing version `1` hashes are validated with the row's
  original nickname snapshot, so pre-upgrade erased bodies still support safe
  retries. Retrying never changes a profile. Raw bodies are never recovered
  from the retained SHA-256 hashes.

Transaction-scoped advisory locks serialize each account's create/rename/ban operations
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
moderation visibility, stable paging, visitor spam limits, administrator frequency
exemption without metadata/name-based escalation, profile ownership, fixed admin
names, renamed historical comments/reply labels, and idempotency across renames.
The runner also creates real data using `001`/`002` before applying `003` to
verify existing nickname snapshots and erased-body request hashes survive the
upgrade. These upgrade fixtures are removed before the main suite; the remaining
fixtures and test helpers are rolled back. Avatar tests use a minimal local
Storage metadata schema with real PostgreSQL RLS to check ownership, fixed paths,
grants, cross-account operations, upsert, session revocation, banned removal and
historical avatar updates. The mock does not upload a JPEG or implement the
Storage HTTP service, MIME/size rejection or CDN behavior; verify those separately
against the production service before claiming a complete upload acceptance.

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
in filename order, `security-regression.sql`, and `avatar-regression.sql` as a
superuser using `psql -v ON_ERROR_STOP=1`.
Do not use these mock/fixture scripts against the production project.

PGlite runs one backend: these tests exercise real SQL, privileges and RPC
behavior but do **not** simulate multiple simultaneous connections, the real
Supabase Auth server, SMTP delivery, or API gateway/JWT verification. The current
production deployment and the remaining real-account acceptance checks are
tracked separately in [COMMENTS-SETUP.md](../COMMENTS-SETUP.md). Public signup
being enabled does not establish that every integration has been verified;
use a staging Supabase project for destructive or multi-account integration tests.
