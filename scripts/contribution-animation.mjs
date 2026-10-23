import { createHash } from 'node:crypto'
import { parse } from 'node-html-parser'
import { contributionCells, contributionGeometry, contributionPalettes, contributionWeeks, normalizeContributions } from '../src/lib/github-contributions.ts'

export const ANIMATION_VERSION = 'calendar-snake-1'
export const STEP_MS = 90
const START_HOLD_MS = 450
const END_HOLD_MS = 650
const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]]
const pointKey = ({ x, y }) => `${x},${y}`
const poseKey = snake => snake.map(pointKey).join(';')
const samePoint = (a, b) => a.x === b.x && a.y === b.y

export const calendarHash = calendar => createHash('sha256').update(JSON.stringify(calendar.contributions)).digest('hex')

// This is an independent implementation, not vendored Platane code. Breadth-first
// search includes the whole four-segment pose: every returned route is shortest
// to its next target and cannot pass through the moving snake's own body.
function shortestPath(start, goal, width) {
  const queue = [{ snake: start, parent: -1 }]
  const seen = new Set([poseKey(start)])
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor]
    if (goal(current.snake)) {
      const result = []
      for (let index = cursor; queue[index].parent !== -1; index = queue[index].parent) result.push(queue[index].snake)
      return result.reverse()
    }
    for (const [dx, dy] of directions) {
      const head = { x: current.snake[0].x + dx, y: current.snake[0].y + dy }
      if (head.x < -1 || head.x > width || head.y < -1 || head.y > 7) continue
      // Entering the old tail is safe because it leaves that cell in this step.
      if (current.snake.slice(0, -1).some(point => samePoint(point, head))) continue
      const snake = [head, ...current.snake.slice(0, -1)]
      const key = poseKey(snake)
      if (seen.has(key)) continue
      seen.add(key)
      queue.push({ snake, parent: cursor })
    }
  }
  throw new Error('No continuous contribution-snake route exists')
}

export function validateRoute(route, cells) {
  if (!route.length || route.some(snake => snake.length !== 4)) throw new Error('Invalid snake pose')
  const width = Math.max(...cells.map(cell => cell.x)) + 1
  const consumed = new Map()
  const active = new Set(cells.filter(day => day.count > 0).map(pointKey))
  for (let step = 0; step < route.length; step++) {
    const snake = route[step]
    if (snake.some(point => !Number.isInteger(point.x) || !Number.isInteger(point.y) || point.x < -1 || point.x > width || point.y < -1 || point.y > 7)) throw new Error('Snake leaves the contribution canvas')
    if (new Set(snake.map(pointKey)).size !== 4) throw new Error('Snake intersects itself')
    for (let part = 1; part < snake.length; part++) {
      if (Math.abs(snake[part].x - snake[part - 1].x) + Math.abs(snake[part].y - snake[part - 1].y) !== 1) throw new Error('Disconnected snake body')
    }
    if (step > 0) {
      const previous = route[step - 1]
      if (Math.abs(snake[0].x - previous[0].x) + Math.abs(snake[0].y - previous[0].y) !== 1) throw new Error('Snake head teleports')
      if (!snake.slice(1).every((point, part) => samePoint(point, previous[part]))) throw new Error('Snake body does not follow its head')
    }
    const key = pointKey(snake[0])
    if (active.has(key) && !consumed.has(key)) consumed.set(key, step)
  }
  if (consumed.size !== active.size) throw new Error('Snake misses contribution cells')
  if (poseKey(route[0]) !== poseKey(route.at(-1))) throw new Error('Snake loop does not close')
  return consumed
}

export function planContributionRoute(calendar) {
  const cells = contributionCells(calendar.contributions)
  const width = contributionWeeks(calendar.contributions).length
  const initial = Array.from({ length: 4 }, (_, x) => ({ x, y: -1 }))
  const route = [initial]
  const remaining = new Set(cells.filter(day => day.count > 0).map(pointKey))
  while (remaining.size) {
    const path = shortestPath(route.at(-1), snake => remaining.has(pointKey(snake[0])), width)
    if (!path.length) throw new Error('Contribution route made no progress')
    route.push(...path)
    for (const snake of path) remaining.delete(pointKey(snake[0]))
  }
  route.push(...shortestPath(route.at(-1), snake => poseKey(snake) === poseKey(initial), width))
  const consumed = validateRoute(route, cells)
  return { cells, width, route, consumed, duration: START_HOLD_MS + (route.length - 1) * STEP_MS + END_HOLD_MS }
}

const percent = (ms, duration) => `${(100 * ms / duration).toFixed(6)}%`
const atStep = step => START_HOLD_MS + step * STEP_MS

function bodyFrames(route, part, duration) {
  const { pitch } = contributionGeometry
  const frames = [`0%{transform:translate(${route[0][part].x * pitch}px,${route[0][part].y * pitch}px)}`]
  route.forEach((snake, step) => {
    const point = snake[part]
    const previous = route[step - 1]?.[part]
    const next = route[step + 1]?.[part]
    // A straight section needs only its endpoints; retain every corner.
    if (previous && next && point.x - previous.x === next.x - point.x && point.y - previous.y === next.y - point.y) return
    frames.push(`${percent(atStep(step), duration)}{transform:translate(${point.x * pitch}px,${point.y * pitch}px)}`)
  })
  frames.push(`100%{transform:translate(${route[0][part].x * pitch}px,${route[0][part].y * pitch}px)}`)
  return frames.join('')
}

export function renderContributionSnake(calendar, theme, plan = planContributionRoute(calendar)) {
  if (!contributionPalettes[theme]) throw new Error('Invalid contribution theme')
  const palette = contributionPalettes[theme]
  const { cells, width, route, consumed, duration } = plan
  const { pitch, size, inset, height } = contributionGeometry
  const css = [`:root{--cb:${palette.border};--cs:${palette.snake};--ce:${palette.colors[0]};${palette.colors.map((color, level) => `--c${level}:${color}`).join(';')}}`,
    `.c{stroke:var(--cb);stroke-width:1px;shape-rendering:geometricPrecision}`,
    ...palette.colors.map((_, level) => `.level-${level}{fill:var(--c${level})}`),
    `.s{fill:var(--cs)}`]
  const rectangles = cells.map((day, index) => {
    const step = consumed.get(pointKey(day))
    const name = `e${index}`
    if (step !== undefined) {
      // Discrete color change occurs at the exact head arrival, never while it
      // is still travelling towards the square.
      css.push(`@keyframes ${name}{0%{fill:var(--c${day.level})}${percent(atStep(step), duration)}{fill:var(--ce)}100%{fill:var(--ce)}}`,
        `.${name}{animation:${name} ${duration}ms steps(1,end) infinite}`)
    }
    return `<rect class="c level-${day.level}${step === undefined ? '' : ` ${name}`}" x="${day.x * pitch + inset}" y="${day.y * pitch + inset}" width="${size}" height="${size}" rx="2" ry="2" data-date="${day.date}" data-count="${day.count}" data-level="${day.level}"${step === undefined ? '' : ` data-consumed-at="${atStep(step)}"`}/>`
  })
  const eaten = cells.filter(day => consumed.has(pointKey(day))).sort((a, b) => consumed.get(pointKey(a)) - consumed.get(pointKey(b)))
  // Equal blocks represent active dates, matching the previous animation's bar.
  eaten.forEach((day, index) => {
    const name = `u${index}`
    const x = index * width * pitch / eaten.length
    const blockWidth = width * pitch / eaten.length
    css.push(`@keyframes ${name}{0%{transform:scaleX(0)}${percent(atStep(consumed.get(pointKey(day))), duration)}{transform:scaleX(1)}100%{transform:scaleX(1)}}`,
      `.${name}{fill:var(--c${day.level});transform:scaleX(0);transform-origin:${x.toFixed(3)}px 0;animation:${name} ${duration}ms steps(1,end) infinite}`)
    rectangles.push(`<rect class="u ${name}" x="${x.toFixed(3)}" y="144" width="${blockWidth.toFixed(3)}" height="12"/>`)
  })
  for (let part = 0; part < 4; part++) {
    const side = [14, 12, 11, 10][part]
    css.push(`@keyframes s${part}{${bodyFrames(route, part, duration)}}`,
      `.s${part}{transform:translate(${route[0][part].x * pitch}px,${route[0][part].y * pitch}px);animation:s${part} ${duration}ms linear infinite}`)
    rectangles.push(`<rect class="s s${part}" x="${(pitch - side) / 2}" y="${(pitch - side) / 2}" width="${side}" height="${side}" rx="${side / 3}" ry="${side / 3}"/>`)
  }
  return `<svg viewBox="-16 -32 ${(width + 2) * pitch} ${height}" width="${(width + 2) * pitch}" height="${height}" xmlns="http://www.w3.org/2000/svg" data-calendar-hash="${calendarHash(calendar)}"><desc>GitHub contribution calendar for Cyril-Fan. Each colored cell is consumed when the snake reaches that date.</desc><style>${css.join('')}</style>${rectangles.join('')}</svg>`
}

const allowedElements = new Set(['svg', 'desc', 'title', 'style', 'g', 'rect', 'path'])
const allowedAttributes = new Set(['viewbox', 'width', 'height', 'xmlns', 'class', 'x', 'y', 'rx', 'ry', 'd', 'fill', 'stroke', 'stroke-width', 'transform', 'data-calendar-hash', 'data-date', 'data-count', 'data-level', 'data-consumed-at'])

export function validateSnake(svg) {
  if (Buffer.byteLength(svg) > 500_000 || !svg.startsWith('<svg ') || !svg.endsWith('</svg>')) throw new Error('Unexpected snake SVG envelope')
  const root = parse(svg)
  for (const node of root.querySelectorAll('*')) {
    if (!allowedElements.has(node.tagName.toLowerCase())) throw new Error('Unexpected snake element')
    for (const name of Object.keys(node.attributes)) if (!allowedAttributes.has(name.toLowerCase())) throw new Error('Unexpected snake attribute')
  }
  if (/url\s*\(|@import|expression\s*\(|javascript:|\\|<!|<\?/i.test(svg)) throw new Error('Active SVG content rejected')
  if (!root.querySelector('style')?.textContent.includes('@keyframes') || root.querySelectorAll('rect.c').length < 365) throw new Error('Incomplete contribution animation')
  return svg
}

export function staticSnake(svg) {
  return svg.replace('</style>', '*{animation:none!important;transition:none!important}</style>')
}

export function assertSnakeMatchesCalendar(svg, calendar, theme, plan) {
  validateSnake(svg)
  const root = parse(svg)
  const cells = contributionCells(calendar.contributions)
  const rectangles = root.querySelectorAll('rect.c')
  const { pitch, inset, size, height } = contributionGeometry
  const width = (contributionWeeks(calendar.contributions).length + 2) * pitch
  if (root.querySelector('svg')?.getAttribute('data-calendar-hash') !== calendarHash(calendar) || rectangles.length !== cells.length) throw new Error('Animation calendar identity mismatch')
  if (root.querySelector('svg')?.getAttribute('viewBox') !== `-16 -32 ${width} ${height}`) throw new Error('Animation canvas mismatch')
  const styles = root.querySelector('style').textContent
  for (const [level, color] of contributionPalettes[theme].colors.entries()) {
    if (!styles.includes(`--c${level}:${color}`) || !styles.includes(`.level-${level}{fill:var(--c${level})}`)) throw new Error('Animation palette mismatch')
  }
  rectangles.forEach((rect, index) => {
    const day = cells[index]
    if (rect.getAttribute('data-date') !== day.date || Number(rect.getAttribute('data-count')) !== day.count || Number(rect.getAttribute('data-level')) !== day.level || !rect.classNames.split(' ').includes(`level-${day.level}`) || Number(rect.getAttribute('x')) !== day.x * pitch + inset || Number(rect.getAttribute('y')) !== day.y * pitch + inset || Number(rect.getAttribute('width')) !== size || Number(rect.getAttribute('height')) !== size) throw new Error('Animation day mismatch')
    if (plan) {
      const step = plan.consumed.get(pointKey(day))
      const expected = step === undefined ? undefined : String(atStep(step))
      if (rect.getAttribute('data-consumed-at') !== expected) throw new Error('Animation consumption timing mismatch')
    }
  })
}

export function createContributionAnimations(input) {
  const calendar = normalizeContributions(input)
  if (!calendar) throw new Error('Invalid contribution calendar')
  const plan = planContributionRoute(calendar)
  const light = renderContributionSnake(calendar, 'light', plan)
  const dark = renderContributionSnake(calendar, 'dark', plan)
  assertSnakeMatchesCalendar(light, calendar, 'light', plan)
  assertSnakeMatchesCalendar(dark, calendar, 'dark', plan)
  return { calendar, plan, light, dark }
}
