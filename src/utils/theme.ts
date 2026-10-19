type Theme = 'system' | 'dark' | 'light'

const themes: Theme[] = ['system', 'dark', 'light']
let fallbackTheme: Theme = 'system'
let themeStorageFailed = false
let systemThemeQuery: MediaQueryList | undefined
let listeningForSystemTheme = false

function isTheme(value: string | null | undefined): value is Theme {
  return themes.includes(value as Theme)
}

function getSystemThemeQuery() {
  return systemThemeQuery ??= window.matchMedia('(prefers-color-scheme: dark)')
}

export function getTheme(): Theme {
  if (themeStorageFailed) return fallbackTheme
  try {
    const storedTheme = localStorage.getItem('theme')
    fallbackTheme = isTheme(storedTheme) ? storedTheme : 'system'
    return fallbackTheme
  } catch {
    themeStorageFailed = true
    return fallbackTheme
  }
}

export function listenThemeChange() {
  if (listeningForSystemTheme) return
  getSystemThemeQuery().addEventListener('change', () => {
    if (getTheme() === 'system') setTheme('system')
  })
  listeningForSystemTheme = true
}

export function setTheme(theme?: string, save = false): Theme | undefined {
  if (theme !== undefined && !isTheme(theme)) return
  let selectedTheme: Theme = isTheme(theme) ? theme : getTheme()
  if (save) {
    if (theme === undefined) {
      selectedTheme = themes[(themes.indexOf(selectedTheme) + 1) % themes.length]
    }
    fallbackTheme = selectedTheme
    try {
      localStorage.setItem('theme', selectedTheme)
    } catch {
      // Retain the selected mode for this document when storage is unavailable.
      themeStorageFailed = true
    }
  }

  const dark = selectedTheme === 'dark' ||
    (selectedTheme === 'system' && getSystemThemeQuery().matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.dataset.theme = selectedTheme
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#0B0B10' : '#FCFCFD')

  return selectedTheme
}
