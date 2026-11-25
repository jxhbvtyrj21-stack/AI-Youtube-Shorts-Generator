// Стенд для тестів: файлова система з фікстур, записи викликів інтерфейсу.
import { mock } from 'claude-code/testing'
import type { On, ThemeSetArgs } from 'claude-code'

import { fromBase64 } from '../hooks/lib/docx'

export type Fixture = { path: string; kind: 'file' | 'dir'; size: number; mtimeMs: number; text?: string; base64?: string }

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function toBase64(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i]! << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0)
    s += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    s += i + 1 < b.length ? B64[(n >> 6) & 63]! : '='
    s += i + 2 < b.length ? B64[n & 63]! : '='
  }
  return s
}

export type Zapysy = {
  status: (string | undefined)[]
  toast: string[]
  notify: string[]
  prompts: string[]
  themes: ThemeSetArgs[]
  opened: string[]
  commands: string[]
}

export type Stend = {
  zapysy: Zapysy
  files: Map<string, Fixture>
  set: (path: string, text: string) => void
  remove: (path: string) => void
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

export function stend(on: On, fixtures: readonly Fixture[], o: { root?: string; now?: number; failStat?: boolean; store?: Record<string, unknown> } = {}): Stend {
  const files = new Map(fixtures.map(f => [f.path, { ...f }]))
  const zapysy: Zapysy = { status: [], toast: [], notify: [], prompts: [], themes: [], opened: [], commands: [] }
  let tick = 1800000000000

  mock.store(on, o.store ?? { teka: '/t/robota' })
  mock.clock(on, { now: o.now ?? Date.UTC(2026, 10, 25, 12, 0) })

  on('fs.read', (_, e) => {
    const f = files.get(norm(e.path))
    if (f === undefined || f.kind !== 'file') return { deny: `read ${e.path} failed: ENOENT` }
    if (e.as === 'bytes') {
      const all = f.base64 !== undefined ? fromBase64(f.base64) : new TextEncoder().encode(f.text ?? '')
      const from = e.offset ?? 0
      const to = e.length === undefined ? all.length : from + e.length
      return { value: { base64: toBase64(all.subarray(from, to)) } }
    }
    return { value: f.text ?? '' }
  })
  on('fs.exists', (_, e) => ({ value: files.has(norm(e.path)) }))
  on('fs.stat', (_, e) => {
    if (o.failStat === true) return { deny: 'stat: EIO, збій диска' }
    const f = files.get(norm(e.path))
    if (f === undefined) return { deny: `stat ${e.path} failed: ENOENT` }
    return { value: { kind: f.kind, size: f.size, mtimeMs: f.mtimeMs, isLink: false } }
  })
  on('fs.list', (_, e) => {
    const dir = norm(e.path)
    if (files.get(dir)?.kind !== 'dir') return { deny: `list ${e.path} failed: ENOENT` }
    const out = [...files.values()]
      .filter(f => f.path.startsWith(dir + '/') && !f.path.slice(dir.length + 1).includes('/'))
      .map(f => ({ name: f.path.slice(dir.length + 1), kind: f.kind, size: f.size, mtimeMs: f.mtimeMs, isLink: false }))
    return { value: out }
  })
  on('fs.write', (_, e) => {
    files.set(norm(e.path), { path: norm(e.path), kind: 'file', size: e.text.length, mtimeMs: tick++, text: e.text })
    return { value: undefined }
  })
  on('session.root', () => ({ value: o.root ?? '/t' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => {
    zapysy.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', (_, e) => {
    zapysy.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.status', (_, e) => {
    zapysy.status.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    zapysy.toast.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', (_, e) => {
    zapysy.notify.push(e.text)
    return { value: { isSent: true, channel: 'terminal_bell' } }
  })
  on('theme.set', (_, e) => {
    zapysy.themes.push(e)
    return { value: { isDrawn: true as const, requestId: 'tema' } }
  })
  on('prompt.submit', (_, e) => {
    zapysy.prompts.push(e.text)
    return { text: e.text }
  })
  on('tool.call', () => ({ result: {} }))
  // Під модом markdown-команда з commands/*.md: її промпт іде моделі.
  on('command.run', (_, e) => ({ text: `markdown:${e.command}` }))

  return {
    zapysy,
    files,
    set: (path, text) => files.set(path, { path, kind: 'file', size: text.length, mtimeMs: tick++, text }),
    remove: path => {
      for (const k of [...files.keys()]) if (k === path || k.startsWith(path + '/')) files.delete(k)
    },
  }
}

export const OPTIONS = {
  vault_path: '/t/skhovyshche',
  kanaly: 'Психологія просто, Наука вголос',
}

export const kmd = (command: string, args = '') => ({
  command,
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 100 },
})

export const ostannii = <T,>(list: readonly T[]) => list[list.length - 1]
