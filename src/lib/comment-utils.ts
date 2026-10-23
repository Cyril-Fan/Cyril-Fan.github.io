/** One discussion for both language routes; never derive identity from the browser user. */
export function commentThread(path: string): string {
  let normalized = path.split(/[?#]/, 1)[0].replace(/^\/en(?=\/)/, '').replace(/\/+$/, '')
  normalized = normalized.replace(/\/index(?:-en)?(?:\.(?:md|mdx))?$/, '')
  if (normalized === '/about' || normalized === '/links' || /^\/blog\/[^?#]+$/.test(normalized)) return normalized
  throw new Error('Invalid comment thread')
}
export type CommentRow = {
  id: string; parent_id: string | null; nickname: string; body: string; created_at: string;
  deleted: boolean; can_delete: boolean; is_admin_author: boolean; is_pending: boolean;
  parent_nickname: string | null; parent_deleted: boolean; author_banned: boolean | null;
  avatar_path?: string | null;
  root_id?: string; root_created_at?: string; root_unavailable?: boolean; gap_before?: boolean;
}
export type CommentMe = { nickname: string | null; can_post: boolean; is_admin: boolean; banned: boolean; moderation_enabled: boolean; avatar_key?: string | null; avatar_path?: string | null }
const commentTimestamp = (value: string) => {
  // PostgreSQL timestamps retain microseconds; Date.parse alone truncates them
  // and could reorder two replies written within the same millisecond.
  const fraction = value.match(/T\d{2}:\d{2}:\d{2}\.(\d+)/)?.[1] ?? ''
  return Date.parse(value) * 1000 + Number(fraction.padEnd(6, '0').slice(3, 6))
}
export function groupCommentRows(rows: CommentRow[]) {
  const byId = new Map(rows.map(row => [row.id, row]))
  const groups = new Map<string, { id: string; created_at: string; root: CommentRow | null; replies: CommentRow[] }>()
  for (const row of rows) {
    let root = row
    const visited = new Set([row.id])
    while (!row.root_id && root.parent_id && byId.has(root.parent_id) && !visited.has(root.parent_id)) {
      visited.add(root.parent_id); root = byId.get(root.parent_id)!
    }
    const id = row.root_id ?? root.parent_id ?? root.id
    let group = groups.get(id)
    if (!group) {
      group = { id, created_at: row.root_created_at ?? root.created_at, root: null, replies: [] }
      groups.set(id, group)
    }
    if (row.id === id && !row.root_unavailable && !row.parent_id) group.root = row
    else group.replies.push(row)
  }
  const compare = (a: CommentRow, b: CommentRow) => commentTimestamp(a.created_at) - commentTimestamp(b.created_at) || a.id.localeCompare(b.id)
  return [...groups.values()].sort((a, b) => commentTimestamp(b.created_at) - commentTimestamp(a.created_at) || b.id.localeCompare(a.id))
    .map(group => ({ ...group, replies: group.replies.sort(compare) }))
}
export function commentError(error: { message?: string; code?: string }, en: boolean): string {
  const code = error.message ?? ''
  const messages: Record<string, [string, string]> = {
    authentication_required: ['请重新登录后再试，草稿仍保留在此页。', 'Please sign in again. Your draft is still here.'],
    email_verification_required: ['请先完成邮箱验证，再登录发布。', 'Verify your email, then sign in to post.'],
    session_expired: ['登录已失效，请重新登录。草稿仍保留。', 'Your session has expired. Sign in again; your draft is still here.'],
    user_banned: ['此账号暂时无法留言。如有疑问，请联系站长。', 'This account cannot post. Please contact the site owner with questions.'],
    rate_limited: ['发布过于频繁，请稍后重试（每 30 秒一条，每 10 分钟最多 5 条）。', 'Please wait before posting again (one per 30 seconds, five per 10 minutes).'],
    duplicate_comment: ['这条内容刚刚发布过，请先刷新确认。', 'You recently posted this content. Refresh to check it first.'],
    invalid_parent: ['回复的留言已无法回复，请取消回复后重新发布。草稿仍保留。', 'This comment can no longer receive replies. Cancel the reply to post your draft.'],
    forbidden: ['你没有执行此操作的权限。', 'You do not have permission to do that.'],
    admin_required: ['此操作需要站长权限。', 'This action requires site owner permissions.'],
    parent_pending: ['请先审核父留言，再审核这条回复。', 'Approve the parent comment before this reply.'],
    thread_depth_exceeded: ['这串讨论已达到回复层级上限，请发布一条新留言。', 'This conversation has reached its reply depth limit. Please start a new comment.'],
    idempotency_conflict: ['提交内容已变化，请修改后重试。', 'The submitted content changed. Please edit it and try again.'],
    invalid_body: ['留言需为 1–2000 字，不能包含特殊控制字符。', 'Use 1–2,000 characters without control characters.'],
    invalid_nickname: ['昵称需为 1–40 字，不能包含特殊控制字符。', 'Use a nickname of 1–40 characters without control characters.'],
    too_many_links: ['每条留言最多包含 5 个网址。', 'A comment can contain at most five web links.'],
    cannot_ban_admin: ['站长账号不能通过留言区封禁。', 'The site owner cannot be banned through comments.'],
    comment_hidden: ['这条留言已被清理，不能重新公开。', 'This comment has been removed and cannot be republished.'],
    comment_author_missing: ['该留言作者的账号已不存在。', 'This comment’s author account no longer exists.'],
    not_found: ['留言已不存在或不可见，请刷新。', 'This comment is no longer available. Please refresh.'],
    invalid_content: ['请检查昵称和内容长度，并移除控制字符或过多链接。', 'Check the nickname and comment length, and remove control characters or excessive links.'],
    invalid_thread: ['留言区地址无效，请刷新页面。', 'This discussion address is invalid. Please refresh.'],
    invalid_cursor: ['留言列表已变化，请刷新后继续阅读。', 'The conversation has changed. Refresh to continue reading.']
  }
  const found = Object.keys(messages).find(key => code.toLowerCase().includes(key))
  return found ? messages[found][en ? 1 : 0] : (en ? 'The comment service is unavailable. Please retry shortly; your draft is kept on this page.' : '留言服务暂时无法连接，请稍后重试；草稿仍保留在此页。')
}
