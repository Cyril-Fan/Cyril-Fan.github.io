# 留言服务部署指南

更新于 2026-10-19。代码采用 **Supabase 邮箱账户 + PostgreSQL 评论接口 + Resend SMTP**，网页仍由 GitHub Pages 发布。

按站主要求，注册和找回的新密码最低长度为 **8 个字符**，不强制大小写、数字和符号组合；仍允许更长密码与密码管理器。Supabase 后台已确认并保存为 8，前端提示与校验同步采用此值。

**当前状态：生产数据库、Auth、SMTP 与控制台邮件模板均已配置，评论前端已发布；2026-10-19 已核实站主注册邮件 Delivered、账户邮箱确认成功，并为该已验证账户授予管理员权限。站主实际登录后，页面已显示登录成功和管理设置。真实发评/删除、管理设置变更、密码找回及双账号权限验收仍待完成，不能将真实账户全流程标记为已验收。**

| 部署项目 | 已核实进度 |
| --- | --- |
| Supabase 项目 | `qztlbyahaabkedmvlxwu`；001 初始迁移、002 待审核父评论权限修复及 003 当前昵称同步迁移均已应用 |
| 基础认证设置 | Confirm email 已开启；匿名登录已关闭；Secure password change 已开启；密码最少 8 个字符，已保存 |
| 站点与回调 | Site URL 为 `https://cyril-fan.top`；已配置中英文两个精确确认地址 |
| 网站公有配置 | 已写入被 Git 忽略的 `.env.local` 与 GitHub Actions Variables；不在本文记录密钥值 |
| Resend 发信子域 | `auth.cyril-fan.top` 的三条相关 DNS 已添加，域名显示 Verified；Enforced TLS 已保存 |
| SMTP | 已保存；域名限定的 Sending access key 仅存 Supabase SMTP 后台，不在文档或网站构建中记录 |
| 邮件模板 | 两份 HTML 已应用到 Supabase 并确认预览正确；注册邮件已真实送达并完成邮箱确认，找回密码邮件仍待真实收件验证 |
| 安全通知与追踪 | Password changed、Email address changed 通知已开启并保存；未配置 tracking 域名，未启用打开/点击追踪 |
| 邮件限额 | 控制台现有值为 30 封/小时（原值即为 30）；每用户间隔 60 秒，注册/登录请求项及验证码验证项的 30 次/5 分钟/IP 限频保持；其余端点按各自配置核对 |
| 发布与真实验收 | 评论前端与 8 字符密码校验已发布；站主注册验证、管理员授予及实际登录已完成；真实发评/删除、管理设置变更、密码找回及双账号测试待完成 |

下文保留完整部署方法，已完成项目无需重复创建、重跑首次迁移、重配 SMTP、重复注册站主账户或重复授予管理员权限。第 9 节保留尚未完成的真实操作验收；本地检查通过、后台保存成功或账户表单已经显示，不能代替完整的真实操作验收。

## 1. 配置分工

| 内容 | 放在哪里 | 是否可以公开 |
| --- | --- | --- |
| Supabase 项目 URL、publishable key 或旧版 anon key | GitHub Actions Variables；本地 `.env.local` | 可以；前端构建需要它们，权限由数据库控制 |
| Supabase secret/service_role key、数据库密码 | 密码管理器与受控后台 | 不可以；不得放入前端变量或 Git 仓库 |
| Resend 发信 API key | Supabase 自定义 SMTP 密码字段 | 不可以；不进入网站构建 |
| SQL 迁移、邮件 HTML 模板 | 本仓库 `supabase/` | 可以；这些文件不包含实际凭据 |
| 账号邮箱、密码散列、账号 ID 与评论归属、私有备份 | Supabase 与单独受控的备份位置 | 不可以上传公开仓库或静态网站目录 |

当前界面只提供邮箱和密码注册/登录，不接匿名或社交登录。阅读公开评论无需账户；发布、回复与管理本人评论要求已验证邮箱。普通用户首次设置公开昵称，之后通过“修改昵称”单独保存；全部历史留言及父回复名称随账户资料更新。站长固定显示 Cyril Fan，无需填写昵称。昵称和用户可修改的 metadata 不决定管理员身份。

## 2. 建立 Supabase 数据库

本项目已在上述 Supabase 项目应用迁移；以下步骤用于核查或以后在新项目恢复部署。

1. 在自己的 Supabase 账户创建项目，选择合适地区。将数据库密码存入密码管理器。
2. 阅读 [supabase/README.md](./supabase/README.md)，在 SQL Editor 以项目数据库管理身份按文件名顺序完整执行 `supabase/migrations/` 中的 001、002、003 迁移。已应用的迁移不重复运行；出错先看事务错误，不要拆成零散语句继续执行。
3. 确认私有 `comment_private` schema 中的 `comments`、`profiles`、`admins`、`bans`、`settings` 表已建立，RLS 与函数授权按迁移保留。
4. 不把 `comment_private` 加入 Data API 的 exposed schemas，不给 `anon`/`authenticated` 角色添加表读取或写入权限。浏览器只调用迁移提供的有限 RPC。

评论 API 返回公开展示所需字段与当前请求者的操作权限，原始 `author_id` 和账户邮箱不应公开。实际 RPC、审核、软删除和错误码以数据库说明为准。

## 3. 设置邮箱账户与确认地址

在 Supabase 项目的 Authentication 设置中完成以下配置；界面栏目名称可能随控制台更新。

本次已核实邮箱确认、匿名关闭、Secure password change、Site URL 与两个精确回调地址，未使用的其他登录提供方均关闭，邮件与主要 IP 限频见顶部状态表。最低 8 字符的密码策略已经后台保存，匹配的前端提示与校验也已发布；JWT 有效期仍应按实际后台核对，不根据源码推断其线上取值。

- 开启 Email/Password 登录和注册，**开启 Confirm email**。不能为了测试方便关闭邮箱确认；否则 `email_confirmed_at` 无法代表收件人完成了验证。
- 关闭 Anonymous sign-ins 和所有未使用的 Social/OAuth/Phone 登录方式。
- 新密码最小长度设为 **8**，不要求额外的大小写、数字或符号组合。网站注册与重置也校验此长度，历史账户登录不强制使用该长度；本次后端保存与前端发布均已完成。
- 保留 **Secure password change** 开启。密码找回通过新邮件链接建立恢复会话，再设置新密码；若后台要求额外验证，应排查恢复会话，不通过关闭安全选项绕过。
- Site URL 设为 `https://cyril-fan.top`。
- Redirect URLs 精确添加 `https://cyril-fan.top/auth/confirm` 与 `https://cyril-fan.top/en/auth/confirm`。生产环境不使用宽泛通配符。
- 验证链接设有限有效期，并按后台实际配置管理。JWT 建议采用较短有效期，例如 15 分钟，同时保留正常刷新机制。

本地联调若需要邮件回到本机，可额外添加自己实际使用的 `http://localhost:4321/auth/confirm` 与英文对应地址；正式验收必须使用生产域名。网站不会接受邮件 URL 中任意外站的 `next`/`redirect_to` 参数。

## 4. 建立 Resend 发信域名与 SMTP

本次专用发信子域为 `auth.cyril-fan.top`，发件人为 `Cyril Fan <no-reply@auth.cyril-fan.top>`。这是身份验证发信地址，不要求把站主现有 QQ 邮箱迁移到新邮件系统。

本次已添加发信子域相关三条 DNS，Resend 显示 Verified；域名限定发信 key 与 SMTP 已保存，Enforced TLS 已开启。2026-10-19 的站主注册邮件已显示 Delivered，并由站主完成邮箱确认。不要重复添加相同 DNS；这一结果只验收了本次注册邮件，找回及安全通知仍需分别检验。

1. 在 Resend 添加 `auth.cyril-fan.top`，选择发信所需区域。
2. 根据 **Resend 当前控制台的实际主机名、类型和记录值**，在阿里云 DNS 添加该子域的 DKIM、SPF 等发信记录。记录可能包含专用于发信退信处理的子域 MX，请按实际完整名称添加。
3. 保留网站根域的 A 记录、`www` CNAME 和已有根域 MX；不为此次发信配置改动它们，也不要开启不需要的收信功能。阿里云“主机记录”填写相对根域的部分，避免重复追加 `cyril-fan.top`。
4. 等待 Resend 显示域名已验证后，创建专用 **Sending access** API key，尽量限定到这个发信域名；不要使用全权限日常管理 key。
5. 关闭邮件的 Open tracking 与 Click/link tracking，避免验证链接被改写。模板也不加载外部图片、字体或追踪像素。
6. 在 Supabase 的 Email / SMTP Settings 启用 Custom SMTP，填入：

| 字段 | 值 |
| --- | --- |
| SMTP Host | `smtp.resend.com` |
| Port | `465`，SSL/TLS |
| Username | `resend` |
| Password | 上一步的 Resend 发信 API key |
| Sender email | `no-reply@auth.cyril-fan.top`，须与已验证域名匹配 |
| Sender name | `Cyril Fan` |

SMTP 参数参考 [Resend 与 Supabase SMTP 官方集成说明](https://resend.com/docs/send-with-supabase-smtp)。注册送达与邮箱确认已核实；找回密码和安全通知的实际送达仍待检验，不能由后台保存成功或单次注册成功推断。

## 5. 应用本站邮件模板

两份本地模板现已应用到 Supabase 控制台并确认预览正确。注册邮件已真实送达并完成邮箱确认；找回密码邮件尚未完成真实收件与恢复流程验收。以下内容供核对和以后恢复配置使用。

在 Supabase Email Templates 中分别替换：

| 邮件类型 | 本地模板 | 已保存主题 |
| --- | --- | --- |
| Confirm signup | [confirm-signup.html](./supabase/email-templates/confirm-signup.html) | `验证邮箱 · Cyril Fan / Confirm your email` |
| Reset password | [recovery.html](./supabase/email-templates/recovery.html) | `重设密码 · Cyril Fan / Reset your password` |

模板中的 `{{ .RedirectTo }}` 取自本站发起请求时指定的确认地址；`{{ .TokenHash }}` 由 Supabase 生成，不能替换成实际用户 token 后提交。

注册邮件链接格式为：

```text
{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email
```

找回邮件使用相同格式，将 `type` 改为 `recovery`。**不要替换成会先消费令牌的 `{{ .ConfirmationURL }}`**，也不要在邮件中直接嵌入 Supabase `/verify` 链接。本站 `/auth/confirm` 与 `/en/auth/confirm` 打开时只展示确认按钮，点击后才 `verifyOtp`；成功后立即清除地址栏中的 token。

确认页设置 `no-referrer` 和 `noindex`。注册确认使用正常账户客户端；密码恢复则使用**本页独立、不持久化的客户端会话**，从点击确认、更新密码到全局退出始终绑定邮件对应的账户，不会把其他标签页的普通登录切换为恢复账户。刷新或关闭恢复页会丢失这一内存会话。

新密码保存后会退出该恢复账户的评论会话，并要求用新密码重新登录；如果密码已保存但退出请求失败，页面会如实提示并提供仍绑定该恢复会话的“重试退出”。已启动的密码保存不会因为组件被移除而跳过退出收尾；关闭整个浏览器或网络中断仍可能终止请求，需通过真实会话验收确认结果。相关变量和防邮件扫描器预消费思路见 [Supabase 邮件模板说明](https://supabase.com/docs/guides/auth/auth-email-templates)。

## 6. 设置邮件额度与请求频率

在 Supabase Authentication → Rate Limits 中，将 **邮件发送总量设为每项目 30 封/小时**，保留同邮箱约 **60 秒**的重发间隔，并核对 signup/recover/resend/verify/token 等默认 IP 限频仍启用。确认自定义 SMTP 已生效；内置测试邮件提供方的默认额度更低。网站的 60 秒提示只是客户端体验，后端限频才是实际约束。[Supabase Auth 限频](https://supabase.com/docs/guides/auth/rate-limits)

截至文档核对日期，Resend Free 的事务邮件额度为 **100 封/日、3,000 封/月**；注册确认、重发、找回及其他已开启的安全通知都会消耗邮件。30 封/小时不能保证整天不触及日额度，仍需查看后台用量。[Resend 定价](https://resend.com/pricing)

机器人可以针对不同邮箱批量注册以消耗额度。当前方案没有额外接入验证码服务；若出现持续滥用，可临时收紧注册/邮件限额并评估 Supabase 支持的 CAPTCHA，不能将当前限频描述为杜绝机器人。未获得新的部署选择前，不自动添加第三方验证码或付费服务。

## 7. 连接网站与自动发布

本次两个公有变量已写入本地 `.env.local` 与 GitHub Actions Variables，SMTP 和模板也已保存；评论前端及 8 字符密码更新均已由 GitHub Actions 构建并发布。下列步骤供后续核查和换项目使用。

1. 从 Supabase 项目连接设置取得项目 URL 和公有 publishable key（或旧版 `anon` key）。**不要复制 `secret` 或 `service_role` key。**
2. 在 GitHub 仓库 **Settings → Secrets and variables → Actions → Variables** 新增两个 Repository variables：

```text
PUBLIC_SUPABASE_URL=https://你的项目.supabase.co
PUBLIC_SUPABASE_ANON_KEY=你的公有publishable或anon密钥
```

3. 本地需要联调时，从 [.env.example](./.env.example) 复制为 `.env.local`，只填这两个公有配置。`.env.local` 已被 Git 忽略；数据库和 SMTP 凭据不进入该文件。
4. 重新运行 GitHub Actions 的 Deploy website 工作流，或推送到 `main`。这是静态网站，新增或修改变量后必须重新构建发布。
5. 打开正式域名，确认账户表单出现。配置缺失时网站显示留言服务准备中的提示；错误配置或后端故障时，页面正文仍能阅读，评论操作显示失败并保留草稿。

登录会话按照静态 Supabase 客户端方式保存在该站浏览器存储中；浏览器禁用存储时退回当前页面内存，刷新后需要重新登录。网站不会把邮箱、令牌或提供方的原始错误写入公共评论事件或界面日志。

## 8. 手工指定站主管理员

2026-10-19 已在站主明确批准后执行管理员授予：受控 SQL 同时核对账户 ID、邮箱和邮箱已确认状态，再加入私有管理员表，随后查询确认 `verified_owner_is_admin=true`。实际账户 ID 不记录在公开仓库。下面保留授权方法供恢复部署时参考；数据库授权成功不等同于管理界面操作已经验收。

先通过正式网站注册并完成站主本人邮箱验证。在 Supabase 受控后台核对该账户的 `auth.users.id`、邮箱和 `email_confirmed_at`，再按 [数据库说明中的管理员步骤](./supabase/README.md) 将这一 **已核实的用户 ID** 加入 `comment_private.admins`。

不通过昵称、邮箱字符串相同、用户 metadata 或前端 `isAdmin` 标记自动授权。管理员身份不会因为公开源码中的站主邮箱而自动产生。

管理员可通过界面处理审核、移除不合适留言与封禁账号。普通用户删除本人评论时保留其他人的回复；账户 ID 与归属关系留在私有数据库中，供权限核验使用。具体软删除、审核可见性、封禁和账户清除差异见数据库说明。

## 9. 生产验收（部分完成）

以下项目需在真实 Supabase 项目和 SMTP 配置中逐项验证，不能用本地模拟测试代替。已完成项记录于 2026-10-19；其余方框保留为待验收，尤其不把邮箱验证成功等同于登录、管理员权限或密码恢复验收。

- [x] 站主使用本人邮箱 A 注册，Resend 发信日志显示注册邮件 Delivered，站主报告已完成邮箱验证，Supabase 账户记录也显示邮箱已确认。
- [x] 经站主批准，将核实为其本人且已确认邮箱的账户加入私有管理员表，数据库查询确认管理员身份。
- [x] 站主已实际登录，正式网站显示邮箱已验证、退出按钮及管理员专属的审核开关；没有为验收改变当前审核设置。
- [ ] 未点击验证邮件按钮时，A 即使直接调用写入 API 也不能发评；直接打开确认页不会提前消费链接。
- [ ] 点击确认后 URL 清理；用相同链接再次确认显示过期/已使用，不能建立新会话。中文和英文回调地址均可用。
- [ ] A 登录并发评，刷新后能读取；退出成功后旧会话不能继续发评、删除或管理评论。评论 RPC 另查服务端会话状态，其他 Supabase API 的旧 access JWT 仍可能在其 TTL 内有效，不把两者混为一谈。
- [ ] 用独立邮箱 B 与独立浏览器会话验证：B 不能删除 A 的评论，伪造 ID、邮箱、昵称、角色或 metadata 也无效；A 删除本人父评论不连带删除 B 的回复。
- [ ] 只有手工登记的站主账号具有审核、移除、封禁权限；新注册账户无法提权。
- [ ] 游客评论列表、RPC 返回及前端网络数据中没有账户邮箱、邮箱哈希、私有作者 ID、密码或 token。
- [ ] 通过真实找回邮件设置新密码；旧密码登录失败，新密码登录成功；修改后退出请求失败时界面不误报已经退出，重试路径可用。
- [ ] 恢复页面打开后，在另一标签页切换账户，并在密码保存前及保存期间测试：不能误改另一个账户的密码，也不能错误地退出另一个账户；保存过程中离开页面的结果与会话状态另行核对。
- [ ] 网络中断、邮件额度不足或 429 时保留输入并给出可理解提示；键盘能够完成登录、验证和密码恢复。
- [ ] 按当前真实部署配置再次核对中英文隐私与使用说明；只陈述已经启用的处理行为。

本地验证可先运行：

```sh
npm test
npm run test:database
npm run check
npm run build
```

本轮已通过 85 项前端/DOM/Auth/主题测试、160 项 PostgreSQL/PGlite 断言（含 7 项旧数据升级检查）。浏览器隔离预览使用真实组件与模拟数据，已检查站长免填昵称、普通用户改名后的历史显示、原地回复、取消保留草稿、快捷键发布、英文游客登录入口及 320px/390px 手机布局；模拟留言没有发到正式站。数据库回归的范围及单后端并发限制见 `supabase/README.md`；这些检查不能替代上面尚未完成的真实账户验收。上线交接时另记真实验收日期、项目身份与结果，不在记录中保留验证码、完整邮件链接或私有账号数据。

## 10. 运行、停用与备份

Supabase Free 项目可能在 **一周无活动后暂停**，免费计划不含自动数据库备份；发生暂停时需要到控制台恢复。评论后端故障不影响已发布的 GitHub Pages 正文，但新评论和动态列表可能暂不可用。[Supabase 免费计划](https://supabase.com/pricing)

定期将数据库迁移与私有评论数据安全导出，迁移或账户清理前也先备份。可在受控环境使用 `pg_dump --format=custom --schema=comment_private` 导出评论 schema；数据库连接凭据通过安全环境或受保护的连接文件提供，不写入公开脚本。**只备份评论表不能还原账号身份与原有归属。** 还需制定覆盖 `auth` 用户与身份资料的完整恢复方案，并在隔离项目验证；避免盲目恢复旧登录会话。[Supabase 备份说明](https://supabase.com/docs/guides/platform/backups)

备份中可能包含账号关联、邮箱和身份凭据资料，必须存入独立受控位置，不放进 Git、GitHub Actions artifact、`public/`、`dist/` 或网站交付目录。应记录备份时间、恢复方式与保留安排，不能把“计划定期备份”描述成“自动备份已完成”。

若需要暂停新注册或发信，先在 Supabase 后台关闭注册/调整限额并保留现有数据库；不要通过删除项目停用评论。停用前端可清空两项公有配置后重新部署，用户会看到准备中的提示；这一步本身不关闭已有 API，需要与后台权限配置配合。
