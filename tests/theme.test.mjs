import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/utils/theme.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText

function runtime(saved, failWrites = false) {
  const state = { saved, failReads: false }
  const darkClasses = new Set()
  const media = { matches: false, listeners: [], addEventListener(_type, callback) { this.listeners.push(callback) } }
  const context = {
    exports: {},
    localStorage: {
      getItem() { if (state.failReads) throw new Error('Storage denied'); return state.saved },
      setItem(_key, value) { if (failWrites) throw new Error('QuotaExceededError'); state.saved = value }
    },
    window: { matchMedia: () => media },
    document: {
      querySelector: () => null,
      documentElement: { dataset: {}, classList: { toggle(name, enabled) { if (enabled) darkClasses.add(name); else darkClasses.delete(name) } } }
    }
  }
  vm.runInNewContext(compiled, context)
  return { api: context.exports, state, media, darkClasses }
}

test('readable but unwritable storage does not trap the theme cycle on its old persisted value', () => {
  const { api, state } = runtime('light', true)
  assert.equal(api.getTheme(), 'light')
  for (const expected of ['system', 'dark', 'light', 'system']) {
    assert.equal(api.setTheme(undefined, true), expected)
    assert.equal(api.getTheme(), expected)
  }
  assert.equal(state.saved, 'light', 'Failed persistence must not be mistaken for a successful write')
})

test('storage becoming unreadable keeps the last known explicit preference through system changes', () => {
  const { api, state, media, darkClasses } = runtime('dark')
  api.listenThemeChange()
  api.setTheme()
  assert.equal(darkClasses.has('dark'), true)
  state.failReads = true
  media.matches = false
  media.listeners.forEach((callback) => callback())
  assert.equal(api.getTheme(), 'dark')
  assert.equal(darkClasses.has('dark'), true)
})

test('writable storage still persists a selection for a new document', () => {
  const { api, state } = runtime(null)
  api.setTheme('dark', true)
  assert.equal(state.saved, 'dark')
  assert.equal(runtime(state.saved).api.getTheme(), 'dark')
})
