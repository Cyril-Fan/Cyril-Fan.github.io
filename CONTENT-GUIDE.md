# 写作与维护指南

日常写作现在可以直接使用 [内容后台](https://cyril-fan.top/admin/)，参见 [后台操作指南](CMS-GUIDE.md)。正文和新图片仅在当前浏览器加密暂存，点发布后才写入 GitHub 原始文件并自动构建。

写文章时，桌面左侧编辑、右侧自动显示当前文章的整体实时预览；手机可切换编辑和文章预览。需要更大空间可打开整篇预览。标题、封面、正文、代码、公式、目录和文末信息与正式文章共用渲染；预览中的留言只作位置说明。学术内容通过结构化表单管理，不设置学术整页预览入口。

以下为代码维护和原有 Markdown / MDX 工作流参考。后台与直接 Git 编辑操作同一份原文件；同一文件的版本冲突必须明确合并。提交到公开仓库的传统 `draft: true` 文件依然公开，不能代替浏览器未提交副本。

MDX 仅支持静态 Aside、Collapse、Spoiler、Steps，不执行 import/export、JavaScript 表达式或事件。恢复和失败处理见 [编辑器指南](CMS-GUIDE.md)。

## 新增一篇文章

在 `src/content/blogs/<research|tech|daily>/` 下新建一个简短的英文目录，例如 `tech/my-first-note/`，再创建 `index.md`（静态主题组件也可用 `index.mdx`）。目录名用于文章地址，发布后尽量不要改动。旧版平铺目录继续兼容，无需移动已有内容。

```text
src/content/blogs/tech/my-first-note/
├── index.md
├── index-en.md       # 可选英文译文
└── experiment.png    # 可选配图
```

`index.md` 最小示例：

```md
---
title: '一篇笔记的标题'
description: '用一句话概括这篇文章。'
publishDate: '2026-10-18'
category: 'tech'
tags: ['python', 'notes']
language: '中文'
draft: true
comment: false
---

在这里写正文。

## 小节

行内公式：$y = f(x)$。

![实验示意图](./experiment.png)
```

使用示例图片语句前，先把自己的图片放入同一目录；没有图片时删掉该行。`title` 最多 60 个字符，`description` 最多 160 个字符；这两项和 `publishDate` 为必填。可用 `updatedDate: '2026-10-19'` 记录后续更新。

## 分类与标签

为每篇文章选择下列一种 `category`，确保它进入相应分类列表：

| category | 用途 |
| --- | --- |
| `research` | 论文阅读、研究笔记、实验方法 |
| `tech` | 编程与技术实践 |
| `daily` | 日常记录 |

`tags` 可填多个词，系统会转为小写并去重。未发布文章时，分类和标签页面显示空状态。月记栏目已移除；旧 `journal` / `month-journal` 分类归入 `daily`，旧入口跳转到日常，不影响文章内容。

## 草稿与公开范围

`draft: true` 的文章可在 `npm run dev` 中预览，生产构建会排除。完成后改成 `draft: false` 再发布。`publishDate` 是展示日期，不是定时发布开关；未来日期的文章也应通过 `draft` 控制是否上线。

**这个仓库是公开仓库，草稿文件一旦提交，源码仍然公开。** 未公开研究、账号密钥和其他私人内容应保留在仓库之外。删除文件也不会自动删除 Git 提交历史。

## 英文与图片

可在同一目录添加 `index-en.mdx`，沿用相同的 frontmatter 字段，将标题、摘要、正文和 `language` 改为英文，并保持相同分类。没有英文译文时，英文博客入口会回落显示中文原文；不需要为每篇文章强制翻译。

正文图片优先使用同目录相对路径，例如 `![说明](./experiment.png)`。封面图可在 frontmatter 增加：

```yaml
heroImage:
  src: './experiment.png'
  alt: '实验结果的简短说明'
```

仅上传有权发布的图片。图片适当压缩并写清 `alt`，不要上传包含私人信息的截图。`public/` 资源使用 `/images/example.png` 这类站点根路径，不要写本机磁盘路径。

## 本地验证与发布

1. 首次运行 `npm install`，日常用 `npm run dev` 预览。
2. 准备发布时运行 `npm run build`，再用 `npm run preview` 检查正式构建，包括搜索、链接、手机宽度和中英文切换。
3. 提交修改并推送到 `Cyril-Fan/Cyril-Fan.github.io` 的 `main` 分支。
4. 在 GitHub **Actions** 查看 `.github/workflows/deploy.yml` 的运行结果；失败时先读日志再修复。
5. 部署完成后实际打开正式域名检查。GitHub 贡献图使用同一份核实快照生成静态方块和蛇图，浏览器也会检查较新的完整数据包；定时构建或手动部署可更新快照。GitHub 调度、网络与缓存可能造成延迟，不保证与 GitHub 页面同时更新。

文章发布后会进入分类、标签、搜索索引与 RSS；无需手工维护文章列表。配置 Supabase 后，非草稿文章默认显示留言区，`comment: false` 可关闭单篇留言入口。中英文对应文章按同一个目录 ID 共用讨论；发布后不要随意改文章目录名，否则会变成新的讨论地址。评论服务配置见 [COMMENTS-SETUP.md](./COMMENTS-SETUP.md)。

## 修改个人信息

- `src/site.config.ts`：站点名称、简介元信息、邮箱、GitHub、域名、头像路径、导航和搜索等开关。
- GitHub Actions repository variables `PUBLIC_SUPABASE_URL` 与 `PUBLIC_SUPABASE_ANON_KEY`：评论服务的公开连接配置；本地开发放到不提交的 `.env.local`。
- `src/data/profile.json`：双语首页、关于页资料、头像与照片引用；对应 `src/pages/` 文件负责页面入口，通常无需编辑。
- `src/data/academic.json`：双语学术背景、研究兴趣、论文及项目字段和顺序；没有成果时保留空列表。
- `public/links.json`：友链、头像网址与 RSS；显示按名称字典序。改用外部头像不会自动删除原有仓库图片，先在后台核对引用再决定是否删除。
- `public/media/`：后台上传的网站图片；其他既有图片位置与组件入口见 [文件位置说明](SITE-CONTENT-MAP.md)。
- `src/pages/terms/` 与 `src/pages/en/terms/`：网站使用、版权与隐私说明；新增外部服务时应同步核对实际行为。

首版公开资料为 Cyril Fan，吉林大学软件工程本科生，关注深度学习、多模态大语言模型与 AI Agents，邮箱 `1943480241@qq.com`，GitHub `Cyril-Fan`。暂无公开成果时保留空状态，后续再补充真实内容。

## 域名与 DNS

域名在阿里云管理，网站由 GitHub Pages 托管。按 GitHub 官方文档配置 DNS；如已有邮件或其他服务记录，先核对用途再修改。

- GitHub **Settings → Pages**：发布来源选 **GitHub Actions**，主域名填 `cyril-fan.top`。
- 根域 `@`：使用 GitHub Pages 官方列出的 A 记录；若添加 AAAA，采用同一官方文档中的 IPv6 地址。
- `www`：添加 CNAME，目标为 `cyril-fan.github.io`，不要填写协议或仓库路径。
- `astro.config.mjs` 中的站点地址应与主域名一致。`public/CNAME` 仅记录主域名；使用 Actions 发布时 GitHub 会忽略它，自定义域名须通过 Pages 设置配置。
- 建议按 GitHub 提示添加域名所有权验证 TXT 记录。等待 DNS 检查和证书就绪后，启用 **Enforce HTTPS**。
- 验证 `https://cyril-fan.top` 可访问，并检查 `https://www.cyril-fan.top` 跳转到根域。DNS 记录存在不代表 HTTPS 与跳转已经成功。

DNS 目标地址以 [GitHub Pages 自定义域名配置文档](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site) 为准。故障排查可参考 [GitHub Pages 自定义域名排错](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/troubleshooting-custom-domains-and-github-pages)。

