# GitHub content editor
[中文](CMS-GUIDE.md) · [Open editor](https://cyril-fan.top/en/admin/) · [File map](SITE-CONTENT-MAP.md)

Sign in with the existing owner account. The editor reads the original GitHub files. Supabase retains accounts, comments, user avatars and page views; it no longer stores a duplicate content library.

## Editing and publishing

1. Choose Home & About, Blog, Academic, Friends or Images. Fixed forms open directly. Blog contains Research, Technical and Daily Life folders, each with articles and collections.
2. Open a file or create content. Edits and new images are automatically saved in this browser, without changing GitHub.
3. Use the Markdown toolbar. Articles open with the editor on the left and the current full article preview on the right; on phones switch between Edit and Article preview. Tools use the text selection or cursor.
4. Choose Review & publish, inspect the original/local comparison and select the files to submit. Include new images referenced by selected content.
5. Submit the selection as one Git commit. “Committed to GitHub · building” is separate from “Published live”; the latter requires the live release marker.

GitHub is public. A committed `draft: true` article is hidden from the website but its source remains public. Keep genuinely private work in the local browser copy.

## Recovery

Each tab has its own encrypted workspace, isolated by owner and repository. Sign in and use Restore local copy after reloading; restoring clones the selected workspace into the current tab. Reload GitHub preserves edits, while Discard local edits removes the chosen file's local changes. New typing during a submission survives completion of the older request.

Ctrl/Cmd+S saves locally. Browsers may warn before leaving, but forced mobile shutdowns may not show a warning. Clearing site data, closing private browsing, storage exhaustion or switching devices can prevent recovery. Export important work as a private JSON file containing text and new image bytes. Backup & restore does not publish it. Search expands from the magnifier on hover, click or keyboard focus; Escape clears it. Completed workspaces with no remaining edits are cleared.

## Content

- Articles: `src/content/blogs/<research|tech|daily>/<folder>/index.md`; English: `index-en.md`. Creation asks only for a folder name; use Edit English version afterwards. Legacy paths remain supported. The English site falls back to Chinese when no translation exists.
- Forms support title, summary, dates, category, tags, cover, source and comments. Unknown frontmatter fields are preserved; use Edit source when needed.
- Markdown supports headings, emphasis, lists, links, images, captions, tables, footnotes, code and math. Theme extensions include `:::note / tip / caution / danger`, `:::details`, `:::steps` and `:::spoiler`. Aside blocks use Axi's icons and type colors; Steps use numbered circles and connecting lines while nested lists remain ordinary lists.
- Safe MDX accepts standalone static Aside, Collapse, Spoiler and Steps tags with literal type/title attributes. Imports, exports, JavaScript expressions, event handlers and arbitrary components are not executed. Raw HTML is displayed as text.
- Collections: `src/content/collection/<category>/<folder>/index.md`, managed inside each Blog category; bilingual metadata, cover, body and an ordered list of article slugs.
- Friends: edit the canonical JSON, upload/choose avatars, add optional feeds. Names always display in dictionary order.
- Academic: bilingual background, CV, interests, complete publication/author/link fields and projects with images, status and ordering.

## Images and deletion

Static uploads use lossless WebP at the original resolution; transparency is retained without automatic resizing. GIF, APNG, animated WebP and AVIF keep their original bytes. Content-addressed filenames prevent stale caches and duplicate uploads. Replace an image and selected references together; the default cleanup option stages deletion of an original only when all references have been updated. Shared originals remain protected. New image, content references and safe deletion publish atomically. Use Clean unused local images to discard unattached browser uploads. Original files on your computer are untouched.

Image cards wrap long filenames and paths. Landscape, portrait and square previews fit fully inside each card at their original aspect ratio, with space around them instead of cropping. Changing a friend's avatar to an external URL leaves the existing GitHub image in the library; it does not upload another copy. To remove the old file, inspect its references, stage deletion only if unused, then publish. Changing an avatar URL never deletes the original implicitly.

Reference checks include source code. Hard-coded application references cannot be changed by the content editor. Deletion is staged locally, confirmed and then removes the current GitHub file. There is no CMS recycle bin: recovery uses Git history without rewriting it. Existing comments are retained. Fixed pages offer Clear content, which keeps the page itself.

## Reliability and limits

Unknown submission result: retry the same request. Conflicting file versions: compare and merge explicitly. Failed image upload: no partial content publication. Failed build: the commit already exists; correct the content or rerun the workflow through GitHub Actions.

Limits: 80 files per submission, 32 MB / 40 megapixels per source image, 8 MB per processed image, 28 MB per request, 500 KB per article, 256 formulas and 2000 characters per formula. Larger formulas are shown literally. Unknown code languages are shown as plain code.

The scoped GitHub credential is server-only, restricted to this repository's Contents read/write and Metadata read. It has no scheduled expiry but may be revoked or rate limited. Local recovery encryption is derived from the Supabase service-role secret; export local work before rotating that secret. Browser copies are not synced across devices. Application code and security configuration remain outside the content editor.

## Migration

The old Supabase CMS was retired on 2026-10-24 after checking the public GitHub files and receiving the owner's confirmation to discard the remaining test-only drafts and images. The old content/history/jobs tables, CMS image bucket, RPCs and publishing function were removed. Accounts, comments, user avatars and page views remain in Supabase. See the [implementation and acceptance record](docs/CMS-IMPLEMENTATION.md) for the audited scope and verification results.

Articles, comments and editor previews share the VS Code Light+ / Dark+ code palettes. Use `cpp` for C++ fences (`CPP`, `c++`, `cc` and `cxx` also work); recognizable legacy C++ includes are detected in unlabelled fences. Unknown languages remain readable and copyable without executing code.

Discard removes the selected file and automatically collects its associated new images when no references remain, including earlier image selections. Images needed by other content, other browser copies or pending submissions remain; unreadable recovery copies also prevent automatic collection. Existing GitHub images and other workspace records are never deleted. Replacement-generated deletion of an original is undone if restored content needs it. Unattached library uploads and exported backups remain. Empty IndexedDB workspaces are deleted and preview URLs revoked; browser database compaction controls when physical disk usage falls.


## Live article preview and collections

The pane beside the article editor shows **the whole article currently being written**. Metadata and body changes update it automatically, including the title, summary, dates, tags, cover, math, highlighted code, table of contents and footer. It shares the published rendering and styles. On phones, switch to Article preview; the larger full-article preview remains available for extra space and desktop/mobile widths. Reload preview retries a slow frame without removing edits.

The preview language selector changes the site interface and date formatting; it does not translate the current document. Use Edit English version to write a translation. Chinese articles display a fallback notice in the English interface. Preview content stays in this browser, and comments use a non-interactive placeholder without sending anything.

Collections use a searchable article picker. Select articles, move them up/down, or remove membership without deleting the original article. Academic has no full-page preview entry; edit its structured forms directly. These cover Axi's main academic fields, including publication images and descriptions, authors and contribution roles, venue/status/year, resource labels, and project year/image/details. Publications group by descending year and retain manual order within each year; project order stays manual. Empty lists remain empty without invented achievements.

Blog lists use the latest valid publication/update activity. Archives group and display original publication dates; publication and modification metadata are separate. Special tags such as C++, C#, spaces and Chinese receive safe static URLs automatically.

## Cleanup of old deployment records

Entering the editor or opening recovery checks old empty committed jobs. Only a fresh server confirmation of **live** deployment permits deletion, including the original record left behind by recovery. Drafts, new images, failed/unknown jobs, offline checks, active tabs and edits made during a check are retained. Cross-tab Web Locks and an atomic encrypted-record comparison protect concurrent saves. Browsers without Web Locks keep old records. Current empty, confirmed-live records continue to be removed automatically. The restore count/list is refreshed; this never writes to GitHub or removes account/comment data.

## Deleting comments

Authors may delete their own comments; the owner can moderate all comments. A comment without replies is deleted from the database without a placeholder. If replies remain, its body, nickname, author association and request fingerprints are cleared, leaving only an anonymous placeholder that preserves the reply structure. Unneeded placeholders are removed automatically when the last reply is deleted. After confirmation, the owner's Delete this comment and its replies action deletes the entire branch from the database. There is no restore action, and no additional deleted records are retained for safe retries.

## Contribution image files

After successfully saving a complete contribution snapshot, the generator keeps only the current light and dark snake images and removes older generated files. Historical compatibility versions are not retained.


## 2026-10-31: saving and deployment status

Restore/import saves the current edits and then the new copy before switching. Any failed write stops the switch; typing during the operation is preserved. Wait for an in-flight submission before switching copies. Committed is distinct from deployed: status is checked against the actual commit served by the live site, and checks resume on tab return or reconnection. Only confirmed-live empty jobs without an active tab lock are collected. Images staged for deletion are not fetched for preview; deletion can be undone before publishing.

Home, owner comments and link-exchange details share the Home & About → Home avatar source. Publish the change, wait for deployment, and reload existing pages. Share **https://cyril-fan.top/avatar/avatar.png** with other sites; this address remains unchanged after replacement. The PNG is generated at build time. The duplicate `public/avatar/avatar.png` source has been removed; the library only manages source images. An empty avatar field falls back to `src/assets/avatar.png`.

The fixed PNG preserves dimensions and transparency without lossy encoding. For animated sources it exports the first frame; the site can still use the original animation. External HTTPS images must be directly accessible without authentication or redirects. A failed download fails that build instead of publishing a stale avatar. GitHub Pages, browser and other sites' image caches can delay updates. Sites that download their own image copy must replace that copy themselves.
