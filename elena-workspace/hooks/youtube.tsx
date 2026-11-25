import { atom, read } from 'claude-code'
import type { On } from 'claude-code'

import type { Kanaly, Video } from '../types'
import { frontmatter, vidnosnoSkhovyshcha } from './lib/perevirky'
import type { $, Cfg, Rishennia } from './spilne'
import {
  PANEL_YOUTUBE, chytaty, join, onovytyStatus, vstanovytyRezhym, zbii,
} from './spilne'

const kanalyA = atom({ plugin: 'elena-workspace', key: 'kanaly' } as const, null, { shape: 'kanaly-1' })

const STRATEGIIA = '70_YouTube/00_Стратегія каналу/Стратегія каналу.md'
const SHCHO_PRATSIUIE = '70_YouTube/40_Аналітика/Що працює.md'

// ---------- Б1. Slash-команди ----------

const KOMANDY = [
  { name: 'хук', description: 'Хуки й структура Shorts (short-form-hooks)', argumentHint: '[тема чи відео]', zavdannia: 'Склади хуки й структуру Shorts за скілом short-form-hooks.' },
  { name: 'сценарій', description: 'Сценарій довгого відео (writing-beats)', argumentHint: '[тема]', zavdannia: 'Напиши сценарій довгого відео за скілом writing-beats.' },
  { name: 'опис', description: 'Назва, опис і CTA (copywriting)', argumentHint: '[відео]', zavdannia: 'Підготуй назву, опис і CTA за скілом copywriting.' },
  { name: 'транскрипт', description: 'Транскрипт відео за посиланням (youtube-transcriber)', argumentHint: '<посилання>', zavdannia: 'Отримай транскрипт відео за посиланням за скілом youtube-transcriber. Для чужого відео у сховище зберігай лише конспект і висновки.' },
  { name: 'ідея', description: 'Нова картка Ю1 у 70_YouTube', argumentHint: '[ідея]', zavdannia: 'Створи нову картку Ю1 у 70_YouTube: спершу дослівно прочитай шаблон Ю1 у 90_Службове/Шаблони/YouTube і дотримуйся його YAML.' },
] as const

async function fragment($: $, cfg: Cfg, rel: string): Promise<string> {
  const text = await chytaty($, join(cfg.vault, rel))
  if (text === undefined) return `--- ${rel} ---\nФайл недоступний: прочитай його сам, а якщо сховище недоступне, скажи про це.`
  const cut = text.length > 8000 ? `${text.slice(0, 8000)}\n[обрізано: дочитай файл повністю]` : text
  return `--- ${rel} ---\n${cut}`
}

export function kontekstYoutube(cfg: Cfg, kanaly: string[], fragmenty: string[]): string {
  const vybir = kanaly.length > 0
    ? `Канали для вибору в AskUserQuestion: ${kanaly.join(', ')}${kanaly.length < 3 ? ', новий канал' : ''}.`
    : 'Назви каналів візьми з файлу «Стратегія каналу.md».'
  return [vybir, `Сховище: ${cfg.vault}.`, 'Вміст файлів стратегії (прочитано модом):', ...fragmenty].join('\n')
}

export const YOUTUBE_KOMANDY = KOMANDY.map(k => k.name as string)

export async function komandaYoutube($: $, cfg: Cfg, name: string, args: string): Promise<{ kontekst?: string }> {
  void args
  const k = KOMANDY.find(x => x.name === name)
  if (k === undefined) return {}
  await vstanovytyRezhym($, 'youtube')
  await onovytyStatus($, cfg)
  if (cfg.youtube.panel) void $.ui.open({ id: PANEL_YOUTUBE, title: 'Канали' })
  const stan = await read($, kanalyA)
  const kanaly = stan?.kanaly ?? cfg.kanaly
  const fragmenty = [await fragment($, cfg, STRATEGIIA), await fragment($, cfg, SHCHO_PRATSIUIE)]
  return { kontekst: kontekstYoutube(cfg, kanaly, fragmenty) }
}

// ---------- Б2. Панель «Канали» ----------

const ETAPY: Video['etap'][] = ['ідея', 'сценарій', 'монтаж', 'опубліковано']

const kolonka = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n))

export function riadkyKanaliv(k: Kanaly | null): { text: string; bold?: boolean; dim?: boolean }[] {
  if (k === null) return [{ text: 'Дані каналів ще не зібрано.', dim: true }]
  if (!k.dostupno) return [{ text: 'Папка 70_YouTube недоступна.', dim: true }]
  const rows: { text: string; bold?: boolean; dim?: boolean }[] = []
  const kanaly = k.kanaly.length > 0 ? k.kanaly : ['без каналу']
  for (const kanal of kanaly) {
    rows.push({ text: kanal, bold: true })
    rows.push({ text: `${kolonka('Відео', 30)} ${kolonka('CTR', 6)} ${kolonka('Утримання', 10)} ${kolonka('Перегляди', 10)}`, dim: true })
    for (const etap of ETAPY) {
      const list = k.video.filter(v => v.kanal === kanal && v.etap === etap)
      rows.push({ text: `${etap[0]!.toUpperCase()}${etap.slice(1)}: ${list.length}` })
      for (const v of list.slice(0, 12)) {
        rows.push({ text: `${kolonka(`  ${v.nazva}`, 30)} ${kolonka(v.ctr ?? '', 6)} ${kolonka(v.utrymannia ?? '', 10)} ${kolonka(v.perehliady ?? '', 10)}` })
      }
      if (list.length > 12) rows.push({ text: `  і ще ${list.length - 12}`, dim: true })
    }
    rows.push({ text: ' ' })
  }
  return rows
}

export function panelHooks(on: On, cfg: Cfg) {
  void cfg
  on('ui.render', { component: 'Pane', requestId: PANEL_YOUTUBE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const k = await read($, kanalyA)
    return (
      <Box flexDirection="column" overflowX="scroll">
        {riadkyKanaliv(k).map(row => (
          <Text bold={row.bold === true} dimColor={row.dim === true}>{row.text === '' ? ' ' : row.text}</Text>
        ))}
      </Box>
    )
  })
}

// ---------- Б3. Захист метрик і транскриптів ----------

const METRYKY = /^(ctr|retention|views|perehliady|utrymannia|avg_view_percentage|avg_view_duration|impressions|watch_time|subscribers_gained|likes)$/i
const METRYKA_V_TEKSTI = /^\s*(ctr|retention|views|perehliady|utrymannia|avg_view_percentage|avg_view_duration|impressions|watch_time)\s*:\s*(\S.*)$/gim


const vidUserky: string[] = []

export function zapamiataty(text: string) {
  vidUserky.push(text)
  if (vidUserky.length > 200) vidUserky.shift()
}

export function nadalaUserka(value: string, prompts: readonly string[] = vidUserky): boolean {
  const digits = value.match(/\d+(?:[.,]\d+)?/g)
  if (digits === null) return true
  return digits.every(d => {
    const forms = [d, d.replace(',', '.'), d.replace('.', ',')]
    return prompts.some(p => forms.some(f => p.includes(f)))
  })
}

const TS = /^\s*[[(]?\d{1,2}:\d{2}(?::\d{2})?[\])]?\s/m

export function ocinkaYoutube(rel: string, content: string, kanaly: string[], prompts: readonly string[] = vidUserky): Rishennia {
  const fm = frontmatter(content) ?? {}
  for (const [key, value] of Object.entries(fm)) {
    if (!METRYKY.test(key) || value === '' || value === 'null' || value === '~') continue
    if (!nadalaUserka(value, prompts)) {
      return { deny: `YouTube: метрику ${key} = ${value} користувачка не надавала, метрики вносить лише вона з YouTube Studio: ${rel}` }
    }
  }
  let m: RegExpExecArray | null
  const re = new RegExp(METRYKA_V_TEKSTI.source, METRYKA_V_TEKSTI.flags)
  const tilo = content.replace(/^---[\s\S]*?\n---/, '')
  while ((m = re.exec(tilo)) !== null) {
    if (!nadalaUserka(m[2] ?? '', prompts)) {
      return { deny: `YouTube: метрику ${m[1]} = ${m[2]?.trim()} користувачка не надавала: ${rel}` }
    }
  }
  const tsLines = content.split('\n').filter(l => TS.test(l + ' ')).length
  const dovhyiTranskrypt = /#+\s*(повний\s+)?(транскрипт|transcript)/i.test(content) && content.length > 6000
  if (tsLines >= 15 || dovhyiTranskrypt) {
    const kanal = (fm['channel'] ?? fm['kanal'] ?? '').toLowerCase()
    const svii = kanal !== '' && kanaly.some(k => k.toLowerCase() === kanal)
    const chuzhyi = /ю5|конкурент|competitor/i.test(`${fm['type'] ?? ''} ${fm['template'] ?? ''} ${rel}`) || (kanal !== '' && kanaly.length > 0 && !svii)
    if (chuzhyi) return { deny: `YouTube: повний транскрипт чужого відео у сховище не копіюється, лише конспект і висновки: ${rel}` }
    if (!svii) return { warn: `YouTube: схоже на повний транскрипт, а канал не визначено. Для чужого відео залиш тільки конспект і висновки: ${rel}` }
  }
  return {}
}

export function zakhystHooks(on: On, cfg: Cfg) {
  on('prompt.submit', ($, e, next) => {
    if ((e.origin as { kind?: string } | undefined)?.kind !== 'plugin') zapamiataty(e.text)
    return next(e)
  })

}


export async function ocinkaVyklykuYoutube($: $, cfg: Cfg, input: Record<string, unknown>): Promise<Rishennia> {
  const path = typeof input['file_path'] === 'string' ? input['file_path'] : typeof input['path'] === 'string' ? input['path'] : undefined
  const content = typeof input['content'] === 'string' ? input['content'] : typeof input['new_string'] === 'string' ? input['new_string'] : undefined
  const rel = path === undefined ? undefined : vidnosnoSkhovyshcha(path, cfg.vault)
  if (rel === undefined || content === undefined) return {}
  const k = await read($, kanalyA)
  return ocinkaYoutube(rel, content, k?.kanaly ?? cfg.kanaly)
}
