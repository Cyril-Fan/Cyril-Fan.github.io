const calendarDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit'
})
function calendarDay(date: Date) {
  const parts = calendarDateFormatter.formatToParts(date)
  const number = (name: string) => Number(parts.find(part => part.type === name)?.value)
  return Date.UTC(number('year'), number('month') - 1, number('day')) / 86400000
}
export function siteDaysOnline(start: Date | string, now = new Date()) {
  const date = new Date(start)
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(now.getTime())) return null
  return Math.max(0, calendarDay(now) - calendarDay(date))
}
export function watchSiteDays(element: HTMLElement, signal: AbortSignal) {
  const update = () => {
    if (document.hidden || signal.aborted) return
    const value = siteDaysOnline(element.dataset.started || '')
    if (value !== null) element.textContent = String(value)
  }
  update()
  const timer = window.setInterval(update, 60000)
  document.addEventListener('visibilitychange', update, { signal })
  signal.addEventListener('abort', () => window.clearInterval(timer), { once:true })
}
