const sections = {
  academic: 'Academic',
  about: 'About',
  archives: 'Archives',
  blog: 'Blog',
  collection: 'Collections',
  links: 'Links',
  projects: 'Projects',
  search: 'Search',
  tags: 'Tags',
  terms: 'Site Policy'
}
const categories = { all: 'All Posts', research: 'Research', tech: 'Technical', technical: 'Technical', daily: 'Daily Life', life: 'Daily Life' }
const policies = { 'privacy-policy': 'Privacy', 'terms-and-conditions': 'Using This Website', copyright: 'Copyright', disclaimer: 'About the Content' }

/** Keep navigation labels in English in browser tabs, without translating authored article titles. */
export function pageTitle(pathname, authoredTitle = '', article = false) {
  const parts = pathname.replace(/^\/en(?:\/|$)/, '/').split('/').filter(Boolean)
  const [section, detail] = parts
  if (!section) return 'Home'
  if (section === '404' || section === '404.html') return 'Page Not Found'
  if (section === 'auth') return 'Confirm Account'
  if (article) return `Blog — ${authoredTitle}`
  if (section === 'blog' && Object.hasOwn(categories, detail)) return `Blog — ${categories[detail]}`
  if (section === 'tags' && detail) return `Tags — ${authoredTitle.replace(/^(?:标签：|Tag:\s*)/, '')}`
  if (section === 'collection' && detail) return `Collections — ${authoredTitle}`
  if (section === 'terms' && Object.hasOwn(policies, detail)) return policies[detail]
  if (Object.hasOwn(sections, section)) return sections[section]
  // New routes remain readable even if their section has not yet been added above.
  const slug = section.replace(/[-_]/g, ' ')
  const fallback = /^[a-z][a-z0-9 ]*$/i.test(slug) ? slug.replace(/\b[a-z]/g, c => c.toUpperCase()) : 'Page'
  return /^[a-z]/i.test(authoredTitle) ? authoredTitle : `${fallback}${authoredTitle ? ` — ${authoredTitle}` : ''}`
}
