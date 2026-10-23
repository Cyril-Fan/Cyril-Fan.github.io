type Store = Pick<Storage, 'getItem' | 'setItem'>
type Options = {
  version: string
  defaultIconPaths: string[]
  storage: Store
  session: Store
  fetch: typeof fetch
}

const cacheKey = 'site-default-icons-version'

/**
 * Versioned page icons and the implicit /favicon.ico use separate cache keys.
 * Revalidate the latter once per brand release without clearing site data or
 * reloading the page. A browser's separate favicon/history DB is not writable
 * by a website: a successful HTTP refresh is not proof of its displayed icon.
 */
export async function refreshDefaultIconCache(options: Options): Promise<boolean> {
  const { version, defaultIconPaths, storage, session, fetch: fetchIcon } = options
  try {
    if (storage.getItem(cacheKey) === version) return true
    if (session.getItem(cacheKey) === version) return false
    session.setItem(cacheKey, version)
  } catch { return false }

  try {
    await Promise.all(defaultIconPaths.map(async path => {
      if (!/^\/(?:favicon\.ico|apple-touch-icon(?:-precomposed)?\.png)$/.test(path)) {
        throw new Error('Unexpected default icon path')
      }
      const response = await fetchIcon(path, {
        cache: 'reload',
        credentials: 'same-origin',
        signal: AbortSignal.timeout(10_000)
      })
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) {
        throw new Error('Default icon unavailable')
      }
      // Consume the whole response before recording this version as refreshed.
      if (!(await response.arrayBuffer()).byteLength) throw new Error('Empty icon')
    }))
    storage.setItem(cacheKey, version)
    return true
  } catch {
    // A later tab/session can retry. Offline visits never lose their last icons.
    return false
  }
}
