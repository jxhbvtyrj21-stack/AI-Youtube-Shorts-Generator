import { atom, read } from 'claude-code'
import type { On, ThemeSetArgs } from 'claude-code'

import type { Rezhym } from '../types'
import { makeColors } from './make-colors.js'
import type { $, Cfg } from './spilne'
import {
  zbii,
} from './spilne'

const robotaA = atom({ plugin: 'elena-workspace', key: 'robota' } as const, null, { shape: 'robota-1' })
const rezhymA = atom({ plugin: 'elena-workspace', key: 'rezhym' } as const, 'nauka')
const potochneA = atom({ plugin: 'elena-workspace', key: 'potochne' } as const, {}, { shape: 'potochne-1' })

// М'яка приглушена палітра: теплий сірий папір удень, графіт уночі.
const SVITLA = {
  'surface-0': '#e9e6df',
  'surface-1': '#efece6',
  'surface-2': '#f5f3ee',
  'text-primary': '#2a2c30',
  'text-secondary': '#474a51',
  'text-muted': '#5d6068',
}
const TEMNA = {
  'surface-0': '#1d1f23',
  'surface-1': '#23262a',
  'surface-2': '#292c31',
  'surface-3': '#2e3237',
  'text-primary': '#e4e2dc',
  'text-secondary': '#c3c0b9',
  'text-muted': '#a29f98',
}

export const AKCENT: Record<Rezhym, { svitlyi: string; temnyi: string; nazva: string }> = {
  nauka: { svitlyi: '#4c6a86', temnyi: '#8fa9c2', nazva: 'Наука' },
  youtube: { svitlyi: '#9c6150', temnyi: '#cf9a87', nazva: 'YouTube' },
}

const ROLI = { danger: '#a04f4f', success: '#5a7a57', warning: '#94763a', pro: '#73638a' }

export function paletra(rezhym: Rezhym) {
  return makeColors({
    label: rezhym === 'nauka' ? 'Робочий простір: наука' : 'Робочий простір: YouTube',
    roles: { accent: AKCENT[rezhym].svitlyi, ...ROLI },
    light: { gray: { anchors: SVITLA } },
    dark: { gray: { anchors: TEMNA } },
  })
}

const STYL: NonNullable<ThemeSetArgs['style']> = {
  Text: { fontSize: 16, lineHeight: 26 },
  Heading: { fontSize: 20, lineHeight: 30, fontWeight: 'semibold' },
}

// Година в часовому поясі користувачки; без Intl береться час середовища.
export function hodyna(ms: number, poias: string): number {
  try {
    const h = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: poias }).format(new Date(ms))
    const n = Number(h)
    if (Number.isFinite(n)) return n
  } catch {
    // немає Intl або поясу
  }
  return new Date(ms).getHours()
}

export const temnaZaraz = (h: number) => h >= 20 || h < 10

let zastosovano = ''

async function zastosuvatyTemu($: $, poias: string): Promise<void> {
  const rezhym = await read($, rezhymA)
  const scheme = temnaZaraz(hodyna(await $.clock.now(), poias)) ? 'dark' : 'light'
  const kliuch = `${rezhym}:${scheme}`
  if (kliuch === zastosovano) return
  const { theme, problems } = paletra(rezhym)
  const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))
  if (unpainted !== undefined) await zbii($, 'тема', unpainted)
  const base: ThemeSetArgs = { colors: theme, overrideColorScheme: scheme }
  try {
    await $.theme.set({ ...base, style: STYL })
  } catch (err) {
    await zbii($, 'типографіка теми', err)
    await $.theme.set(base)
  }
  zastosovano = kliuch
}

let poiasTem: string | undefined

export function temyHooks(cfg: Cfg, poias: string) {
  void cfg
  poiasTem = poias
}

export async function pisliaZminyRezhymu($: $): Promise<void> {
  if (poiasTem !== undefined) await zastosuvatyTemu($, poiasTem)
}

export async function startTemy($: $, poias: string): Promise<void> {
  zastosovano = ''
  await zastosuvatyTemu($, poias)
  $.clock.every(60_000, () => zastosuvatyTemu($, poias).catch(err => zbii($, 'перемикання теми', err)))
}

export function banerHooks(on: On, cfg: Cfg, poias: string) {
  void cfg
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const rezhym = await read($, rezhymA)
    const scheme = temnaZaraz(hodyna(await $.clock.now(), poias)) ? 'temnyi' : 'svitlyi'
    const a = AKCENT[rezhym]
    let nazva = ''
    if (rezhym === 'nauka') nazva = (await read($, robotaA))?.nazva ?? 'роботу не обрано'
    else {
      const p = await read($, potochneA)
      nazva = p.video ?? (p.kanal === undefined ? 'відео не обрано' : `канал ${p.kanal}`)
    }
    const width = Math.max(20, (e.props.bodyColumns ?? 80) - a.nazva.length - 4)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text bold color={a[scheme]}>{a.nazva}</Text>
        <Text>{` — ${nazva.length > width ? `${nazva.slice(0, width - 1)}…` : nazva}`}</Text>
      </Box>
    )
  }).catch(($, e, next) => next(e))
}

