# GitHub content editor
[中文](CMS-GUIDE.md) · [Open editor](https://cyril-fan.top/en/admin/) · [File map](SITE-CONTENT-MAP.md)

Sign in with the existing owner account. The editor reads the original GitHub files. Supabase retains accounts, comments, user avatars and page views; it no longer stores a duplicate content library.

## Editing and publishing

1. Choose Articles, Friends, Home & About, Academic, Collections or Images.
2. Open a file or create content. Edits and new images are automatically saved in this browser, without changing GitHub.
3. Use the Markdown toolbar and live preview. Desktop supports split view; on phones switch between Edit and Preview. Tools use the text selection or cursor.
4. Choose Review & publish, inspect the original/local comparison and select the files to submit. Include new images referenced by selected content.
5. Submit the selection as one Git commit. “Committed to GitHub · building” is separate from “Published live”; the latter requires the live release marker.

GitHub is public. A committed `draft: true` article is hidden from the website but its source remains public. Keep genuinely private work in the local browser copy.

## Recovery

Each tab has its own encrypted workspace, isolated by owner and repository. Sign in and use Restore local copy after reloading; restoring clones the selected workspace into the current tab. Reload GitHub preserves edits, while Discard local edits removes the chosen file's local changes. New typing during a submission survives completion of the older request.

Ctrl/Cmd+S saves locally. Browsers may warn before leaving, but forced mobile shutdowns may not show a warning. Clearing site data, closing private browsing, storage exhaustion or switching devices can prevent recovery. Export important work as a private JSON file containing text and new image bytes. Import/export does not publish it. Completed workspaces with no remaining edits are cleared.

## Content

- Articles: `src/content/blogs/<slug>/index.md`; English: `index-en.md`. The English site falls back to Chinese when no translation exists.
- Forms support title, summary, dates, category, tags, cover, source and comments. Unknown frontmatter fields are preserved; use Edit source when needed.
- Markdown supports headings, emphasis, lists, links, images, captions, tables, footnotes, code and math. Theme extensions include `:::note / tip / caution / danger`, `:::details`, `:::steps` and `:::spoiler`.
- Safe MDX accepts standalone static Aside, Collapse, Spoiler and Steps tags with literal type/title attributes. Imports, exports, JavaScript expressions, event handlers and arbitrary components are not executed. Raw HTML is displayed as text.
- Collections: bilingual metadata, cover, body and an ordered list of article slugs.
- Friends: edit the canonical JSON, upload/choose avatars, add optional feeds. Names always display in dictionary order.
- Academic: bilingual background, CV, interests, complete publication/author/link fields and projects with images, status and ordering.

## Images and deletion

Static uploads are optimized as WebP; transparent pixels are retained. GIF, APNG, animated WebP and AVIF keep their original bytes. Content-addressed filenames prevent stale caches and duplicate uploads. Replace an image and selected references together; the old image remains until no references exist.

Reference checks include source code. Hard-coded application references cannot be changed by the content editor. Deletion is staged locally, confirmed and then removes the current GitHub file. There is no CMS recycle bin: recovery uses Git history without rewriting it. Existing comments are retained. Fixed pages offer Clear content, which keeps the page itself.

## Reliability and limits

Unknown submission result: retry the same request. Conflicting file versions: compare and merge explicitly. Failed image upload: no partial content publication. Failed build: the commit already exists; correct the content or rerun the workflow through GitHub Actions.

Limits: 80 files per submission, 8 MB per processed image, 28 MB per request, 500 KB per article, 256 formulas and 2000 characters per formula. Larger formulas are shown literally. Unknown code languages are shown as plain code.

The scoped GitHub credential is server-only, restricted to this repository's Contents read/write and Metadata read. It has no scheduled expiry but may be revoked or rate limited. Local recovery encryption is derived from the Supabase service-role secret; export local work before rotating that secret. Browser copies are not synced across devices. Application code and security configuration remain outside the content editor.

## Migration

The old Supabase CMS was retired on 2026-10-24 after checking the public GitHub files and receiving the owner's confirmation to discard the remaining test-only drafts and images. The old content/history/jobs tables, CMS image bucket, RPCs and publishing function were removed. Accounts, comments, user avatars and page views remain in Supabase. See the [implementation and acceptance record](docs/CMS-IMPLEMENTATION.md) for the audited scope and verification results.
