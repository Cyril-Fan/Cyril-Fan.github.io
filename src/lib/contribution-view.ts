import { fetchContributionBundle, fetchPublishedContributionBundle, REFRESH_INTERVAL_MS } from './contribution-feed'
import { contributionWeeks } from './github-contributions'
import type { ContributionBundle } from './contribution-feed'
import type { ContributionDay } from './github-contributions'

export class ContributionSnake extends HTMLElement {
  private controller?: AbortController
  connectedCallback() {
    if (this.controller) return
    this.controller = new AbortController()
    const { signal } = this.controller
    const button = this.querySelector<HTMLButtonElement>('[data-snake-toggle]')
    if (!button) return
    const en = this.dataset.lang === 'en'
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const calendar = this.querySelector<HTMLElement>('.contribution-calendar')
    const animation = this.querySelector<HTMLElement>('.snake-animated')
    const date = this.querySelector<HTMLInputElement>('[data-contribution-date]')
    const output = this.querySelector<HTMLOutputElement>('[data-contribution-detail]')
    let squares = Array.from(this.querySelectorAll<SVGElement>('[data-date]'))
    let userChoice = false
    const label = (day: ContributionDay) => en ? `${day.date}: ${day.count} contributions` : `${day.date}：${day.count} 次贡献`
    const setPlaying = (playing: boolean) => {
      this.dataset.playing = String(playing)
      button.setAttribute('aria-pressed', String(playing))
      calendar?.setAttribute('aria-hidden', String(playing))
      animation?.setAttribute('aria-hidden', String(!playing))
      if (date) date.disabled = playing
      button.textContent = en ? (playing ? 'Turn off animation' : 'Turn on animation') : (playing ? '关闭动画' : '开启动画')
    }
    const show = (square: SVGElement, focus = false) => {
      for (const item of squares) { item.removeAttribute('data-selected'); item.setAttribute('tabindex', '-1') }
      square.setAttribute('data-selected', '')
      square.setAttribute('tabindex', '0')
      if (date) date.value = square.dataset.date || ''
      if (output) output.textContent = square.getAttribute('aria-label')
      if (focus) square.focus()
    }
    // Delegate to the stable calendar container; refreshed cells get the same controls.
    const targetSquare = (event: Event) => event.target instanceof Element ? event.target.closest<SVGElement>('[data-date]') : null
    for (const event of ['pointerover', 'focusin', 'click']) calendar?.addEventListener(event, event => {
      const square = targetSquare(event)
      if (square && this.dataset.playing !== 'true') show(square)
    }, { signal })
    calendar?.addEventListener('keydown', event => {
      const square = targetSquare(event)
      if (!square) return
      const key = event.key
      const position = squares.indexOf(square)
      const offsets: Record<string, number> = { ArrowLeft:-7, ArrowRight:7, ArrowUp:-1, ArrowDown:1 }
      const target = key === 'Home' ? 0 : key === 'End' ? squares.length - 1 : key in offsets ? position + offsets[key] : null
      if (target === null) return
      event.preventDefault()
      show(squares[Math.max(0, Math.min(squares.length - 1, target))], true)
    }, { signal })
    date?.addEventListener('change', () => {
      const square = squares.find(square => square.dataset.date === date.value)
      if (square) show(square)
      else if (output) output.textContent = en ? 'Choose a date within the displayed range.' : '请选择展示范围内的日期。'
    }, { signal })
    setPlaying(this.dataset.playing ? this.dataset.playing === 'true' : !motion.matches)
    button.hidden = false
    button.addEventListener('click', () => { userChoice = true; setPlaying(this.dataset.playing !== 'true') }, { signal })
    motion.addEventListener('change', () => { if (motion.matches || !userChoice) setPlaying(!motion.matches) }, { signal })

    const apply = async (bundle: ContributionBundle) => {
      if (Date.parse(bundle.fetchedAt) < Date.parse(this.dataset.updated || '1970-01-01')) return
      const count = this.querySelector<HTMLElement>('[data-contribution-total]')
      const updateCaption = () => {
        this.dataset.sourceCommit = bundle.sourceCommit
        this.dataset.dataHash = bundle.dataHash
        this.dataset.updated = bundle.fetchedAt
        if (count) {
          count.textContent = en ? `${bundle.calendar.total} contributions` : `${bundle.calendar.total} 次贡献`
          const updated = new Intl.DateTimeFormat(en ? 'en-GB' : 'zh-CN', { dateStyle:'short', timeStyle:'short', hourCycle:'h23', timeZone:'Asia/Shanghai' }).format(new Date(bundle.fetchedAt))
          count.title = `${bundle.calendar.contributions[0].date} – ${bundle.dataThrough} · ${en ? 'Updated' : '更新于'} ${updated} UTC+8`
        }
      }
      if (bundle.dataHash === this.dataset.dataHash) { updateCaption(); return }
      const light = this.querySelector<HTMLImageElement>('.snake-light')
      const dark = this.querySelector<HTMLImageElement>('.snake-dark')
      const svg = calendar?.querySelector('svg')
      const canvas = this.querySelector<HTMLElement>('.contribution-canvas')
      if (!light || !dark || !svg || !canvas) return
      const urls = [bundle.light, bundle.dark].map(text => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text))
      {
        await Promise.all(urls.map(async url => { const image = new Image(); image.src = url; await image.decode() }))
        if (signal.aborted) return
        const previousDate = date?.value
        const hadFocus = squares.includes(document.activeElement as SVGElement)
        const fragment = document.createDocumentFragment()
        const create = (tag: string, attributes: Record<string, string>) => {
          const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
          for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value)
          return node
        }
        const weeks = contributionWeeks(bundle.calendar.contributions)
        weeks.forEach((week, column) => {
          const first = week.find(day => day !== null)
          if (first && (column === 0 || first.date.slice(5, 7) !== weeks[column - 1].find(day => day !== null)?.date.slice(5, 7))) {
            const text = create('text', { class:'month-label', x:String(column * 16 + 2), y:'-12' })
            text.textContent = en ? new Date(`${first.date}T00:00:00Z`).toLocaleDateString('en', { month:'short', timeZone:'UTC' }) : `${Number(first.date.slice(5, 7))}月`
            fragment.append(text)
          }
          week.forEach((day, row) => {
            if (!day) return
            const rect = create('rect', { class:`contribution-day level-${day.level}`, x:String(column * 16 + 2), y:String(row * 16 + 2), width:'12', height:'12', rx:'2', role:'button', tabindex:'-1', 'data-date':day.date, 'data-count':String(day.count), 'data-level':String(day.level), 'aria-label':label(day) })
            const title = create('title', {}); title.textContent = label(day); rect.append(title); fragment.append(rect)
          })
        })
        // The visible pair, date cells and count change in one task after both images decode.
        light.src = urls[0]; dark.src = urls[1]
        for (const image of [light, dark]) { image.width = bundle.width; image.height = bundle.height }
        svg.setAttribute('viewBox', `-16 -32 ${bundle.width} ${bundle.height}`)
        svg.setAttribute('width', String(bundle.width)); svg.setAttribute('height', String(bundle.height))
        svg.setAttribute('aria-label', en ? `${bundle.calendar.total} contributions` : `${bundle.calendar.total} 次贡献`)
        svg.replaceChildren(fragment)
        canvas.style.aspectRatio = `${bundle.width}/${bundle.height}`
        squares = Array.from(svg.querySelectorAll<SVGElement>('[data-date]'))
        if (date) { date.min = bundle.calendar.contributions[0].date; date.max = bundle.dataThrough }
        show(squares.find(square => square.dataset.date === previousDate) ?? squares.at(-1)!, hadFocus)
        updateCaption()
      }
    }
    let lastCheck = 0, checking = false
    const showFreshness = () => {
      const notice = this.querySelector<HTMLElement>('[data-contribution-stale]')
      if (notice) notice.hidden = !this.dataset.updated || Date.now() - Date.parse(this.dataset.updated) <= 36 * 60 * 60 * 1000
    }
    const refresh = async () => {
      if (document.hidden || signal.aborted || checking || Date.now() - lastCheck < REFRESH_INTERVAL_MS) return
      checking = true; lastCheck = Date.now()
      try {
        let bundle
        try { bundle = await fetchContributionBundle({ signal, currentCommit:this.dataset.sourceCommit }) }
        catch {
          if (signal.aborted) return
          bundle = await fetchPublishedContributionBundle({ signal })
        }
        if (bundle && !signal.aborted) await apply(bundle)
      } catch { /* Offline, rate-limited or half-published: retain the complete local snapshot. */ }
      finally { checking = false; showFreshness() }
    }
    // No credentials or site session are sent to GitHub; requests are limited per page.
    void refresh()
    showFreshness()
    const timer = window.setInterval(() => { void refresh() }, REFRESH_INTERVAL_MS)
    signal.addEventListener('abort', () => window.clearInterval(timer), { once:true })
    document.addEventListener('visibilitychange', () => { void refresh() }, { signal })
  }
  disconnectedCallback() {
    this.controller?.abort(); this.controller = undefined
  }
}
