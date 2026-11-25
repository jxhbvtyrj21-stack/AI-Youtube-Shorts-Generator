import { atom, read } from 'claude-code'
import type { CommandRunResult, On } from 'claude-code'

import type { Robota } from '../types'
import {
  DOZVOLENI, basename, normPath, rosiiskiPosylannia, rosiiskyiDomen, khost,
  vidnosnoSkhovyshcha, yamlNotatkyClaude, zvedennia,
} from './lib/perevirky'
import type { $, Cfg, DocxVysnovok, Rishennia } from './spilne'
import {
  PANEL_NAUKA, chytaty, isnuie, join, onovytyRobotu, onovytyStatus, perevirDocx, shliakhyDocx, spovistyty, vidsotok, vstanovytyRezhym, zbii, znaityTeku,
} from './spilne'

const robotaA = atom({ plugin: 'elena-workspace', key: 'robota' } as const, null, { shape: 'robota-1' })

type Input = Record<string, unknown>

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)


// ---------- А1. Перед видачею файлу ----------

function povidomlenniaVydachi(file: string, v: DocxVysnovok): string {
  const lines = [`Перед видачею файлу: ${basename(file)} не можна видавати.`]
  if (v.vychytano === false) lines.push(`- у ${v.stan ?? 'stan.md'} немає запису про фінальне вичитування за ukrainian-proofreading-editor`)
  const sure = v.porushennia.filter(p => p.bezsumnivne)
  const doubt = v.porushennia.filter(p => !p.bezsumnivne)
  if (sure.length > 0) lines.push(zvedennia(sure))
  if (doubt.length > 0) lines.push(`Перевір також:\n${zvedennia(doubt, 8)}`)
  return lines.join('\n')
}

function poperedzhenniaVydachi(file: string, v: DocxVysnovok): string | undefined {
  const doubt = v.porushennia.filter(p => !p.bezsumnivne || v.stan === undefined)
  if (doubt.length === 0) return undefined
  const head = v.stan === undefined
    ? `Перед видачею файлу: ${basename(file)} поза робочою текою конвеєра, перевір вручну:`
    : `Перед видачею файлу: у ${basename(file)} є місця для перевірки:`
  return `${head}\n${zvedennia(doubt)}`
}

async function perevirkaVydachi($: $, cfg: Cfg, files: string[]): Promise<Rishennia> {
  const deny: string[] = []
  const warn: string[] = []
  for (const f of files) {
    const v = await perevirDocx($, f, cfg.nauka.zaglushkyBlok)
    if (v.blokuvaty) deny.push(povidomlenniaVydachi(f, v))
    else {
      const w = poperedzhenniaVydachi(f, v)
      if (w !== undefined) warn.push(w)
      else if (v.vychytano === true) await spovistyty($, `Файл готовий до видачі: ${basename(f)}`)
    }
  }
  const out: Rishennia = {}
  if (deny.length > 0) out.deny = deny.join('\n')
  if (warn.length > 0) out.warn = warn.join('\n')
  return out
}

const COPY = /\b(cp|mv|copy|move|copy-item|move-item|rsync|robocopy|xcopy)\b|shutil\.(copy\w*|move)/i

export async function ocinkaVydachi($: $, cfg: Cfg, tool: string, input: Input): Promise<Rishennia> {
  if (tool === 'SendUserFile') {
    const files = Array.isArray(input['files']) ? input['files'].filter((f): f is string => typeof f === 'string') : []
    const docx = files.filter(f => /\.docx$/i.test(f))
    return docx.length === 0 ? {} : perevirkaVydachi($, cfg, docx)
  }
  const cmd = tool === 'Bash' || tool === 'PowerShell' ? str(input['command']) : undefined
  if (cmd === undefined || !/\.docx/i.test(cmd) || !COPY.test(cmd)) return {}
  for (const p of shliakhyDocx(cmd)) {
    const st = await $.fs.stat(p).catch(() => undefined)
    if (st?.kind === 'file') return perevirkaVydachi($, cfg, [p])
  }
  return {}
}

// ---------- А2. Захист бази знань ----------

const DESTRUKTYV = /\b(rm|rmdir|unlink|del|erase|rd|mv|move|ren|rename|remove-item|move-item|rename-item|truncate|shred)\b|sed\s+-i|os\.(remove|unlink|rename|replace)\b|shutil\.(move|rmtree)|\.unlink\(|\.rename\(/i
const ZAPYS = /(^|[^>\d&])>>?(?![&>])|\btee\b|\b(cp|copy|copy-item|set-content|add-content|out-file|new-item|touch|mkdir|md)\b|write_text|open\([^)]*['"][wax]/i

const KB = (prychyna: string, rel: string) => `Захист бази знань: ${prychyna}: ${rel === '' ? 'корінь сховища' : rel}`

export async function perevirStvorennia($: $, rel: string, path: string, content: string): Promise<Rishennia> {
  const segs = rel.split('/')
  if (rel === '' || segs.some(s => s.toLowerCase() === '.obsidian')) return { deny: KB('зміни в .obsidian/ заборонено', rel) }
  const exists = await isnuie($, path)
  if (exists === undefined) return { warn: KB('не вдалося перевірити, чи файл новий, наявні нотатки не змінюй', rel) }
  if (exists) return { deny: KB('нотатка вже існує, змінювати наявні нотатки заборонено', rel) }
  const top = (segs[0] ?? '').normalize('NFC').toLowerCase()
  if (segs.length < 2 || !DOZVOLENI.some(d => d.toLowerCase() === top)) {
    return { deny: KB('нові нотатки дозволено лише в 00_Вхідні, 50_Проєкти і 70_YouTube', rel) }
  }
  if (!/\.md$/i.test(rel)) return { deny: KB('дозволено створювати лише нотатки .md', rel) }
  const yaml = yamlNotatkyClaude(content)
  if (yaml !== undefined) return { deny: KB(`у новій нотатці ${yaml}`, rel) }
  return {}
}

function shliakhyPisliaPerenapravlennia(cmd: string): string[] {
  const out: string[] = []
  const re = /(?:^|[^>\d&])>>?\s*(?:"([^"]+)"|'([^']+)'|([^\s;|&]+))|\b(?:set-content|add-content|out-file)\s+(?:-(?:path|filepath|literalpath)\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;|&]+))/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(cmd)) !== null) {
    const p = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6]
    if (p !== undefined) out.push(p)
  }
  return out
}

const SHLIAKHOVI = ['path', 'file_path', 'filePath', 'filepath', 'source', 'destination', 'target', 'old_path', 'new_path', 'from', 'to', 'notebook_path', 'dir', 'directory']

export async function ocinkaKB($: $, cfg: Cfg, tool: string, input: Input): Promise<Rishennia> {
  const rel = (p: string | undefined) => (p === undefined ? undefined : vidnosnoSkhovyshcha(p, cfg.vault))
  if (tool === 'Write') {
    const path = str(input['file_path'])
    const r = rel(path)
    if (r === undefined || path === undefined) return {}
    return perevirStvorennia($, r, path, str(input['content']) ?? '')
  }
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    const r = rel(str(input['file_path']) ?? str(input['notebook_path']))
    return r === undefined ? {} : { deny: KB('редагувати наявні нотатки заборонено', r) }
  }
  if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = str(input['command']) ?? ''
    const v = normPath(cfg.vault)
    const n = normPath(cmd)
    if (v === '' || !(n.includes(v) || n.includes('my_knowledge_system/01_obsidian/knowledge_base'))) return {}
    const isWrite = ZAPYS.test(cmd) || DESTRUKTYV.test(cmd)
    if (/\.obsidian/i.test(cmd) && isWrite) return { deny: KB('зміни в .obsidian/ заборонено', '.obsidian') }
    if (DESTRUKTYV.test(cmd)) return { deny: KB('видаляти, переміщувати чи перейменовувати файли сховища заборонено', 'команда оболонки') }
    for (const p of shliakhyPisliaPerenapravlennia(cmd)) {
      const r = rel(p)
      if (r !== undefined && (await isnuie($, p)) === true) return { deny: KB('перезаписувати наявні нотатки заборонено', r) }
    }
    if (isWrite) return { warn: KB('запис у сховище з оболонки не перевірено, нові нотатки створюй інструментом Write', 'команда оболонки') }
    return {}
  }
  const name = tool.toLowerCase()
  const paths = SHLIAKHOVI.map(k => str(input[k])).filter((p): p is string => p !== undefined)
  const inVault = paths.map(p => ({ p, r: rel(p) })).filter((x): x is { p: string; r: string } => x.r !== undefined)
  if (inVault.length === 0) return {}
  const first = inVault[0]!
  if (/delete|remove|move|rename|edit|replace|patch|append|update/.test(name)) {
    return { deny: KB('змінювати, переміщувати чи видаляти файли сховища заборонено', first.r) }
  }
  if (/write|create|save|put|upload|copy/.test(name)) {
    const content = str(input['content']) ?? str(input['text']) ?? str(input['data'])
    if (content === undefined) return { warn: KB('запис у сховище цим інструментом не перевірено', first.r) }
    return perevirStvorennia($, first.r, first.p, content)
  }
  return {}
}

// ---------- А3. Фільтр джерел ----------

const REIESTR = /(^|[\\/])dzherela(_\d+)?\.tsv$/i

function riadkyReiestru(text: string): string | undefined {
  const found = rosiiskiPosylannia(text)
  if (found.length === 0) return undefined
  const list = found.slice(0, 8).map(f => `рядок ${f.riadok} (${f.prychyna})`).join(', ')
  return `Фільтр джерел: у реєстрі не може бути російських і білоруських джерел: ${list}. Вилучи ці рядки.`
}

export async function ocinkaDzherel($: $, tool: string, input: Input): Promise<Rishennia> {
  if (tool === 'Write') {
    const path = str(input['file_path']) ?? ''
    if (!REIESTR.test(path)) return {}
    const deny = riadkyReiestru(str(input['content']) ?? '')
    return deny === undefined ? {} : { deny }
  }
  if (tool === 'Edit') {
    const path = str(input['file_path']) ?? ''
    if (!REIESTR.test(path)) return {}
    const old = (await chytaty($, path)) ?? ''
    const from = str(input['old_string']) ?? ''
    const to = str(input['new_string']) ?? ''
    const result = from === '' ? to : input['replace_all'] === true ? old.split(from).join(to) : old.replace(from, () => to)
    const deny = riadkyReiestru(result)
    return deny === undefined ? {} : { deny }
  }
  if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = str(input['command']) ?? ''
    if (!/dzherela(_\d+)?\.tsv/i.test(cmd) || !ZAPYS.test(cmd)) return {}
    const found = rosiiskiPosylannia(cmd)
    if (found.length === 0) return {}
    return { deny: `Фільтр джерел: команда вносить у реєстр джерело (${found[0]!.prychyna}). Таких джерел у реєстрі бути не може.` }
  }
  const url = str(input['url'])
  if (url !== undefined) {
    const host = khost(url)
    const prychyna = host === undefined ? undefined : rosiiskyiDomen(host)
    if (prychyna !== undefined) {
      return { warn: `Фільтр джерел: ${prychyna}. Російські й білоруські джерела в роботу не беруться, у реєстр такий рядок не пропущу.` }
    }
  }
  return {}
}

// ---------- А5. Панель «Хід роботи» ----------

const ZNAK = { закрито: '✓', поточна: '▶', відкрита: '○' } as const

const obriz = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)

export function riadkyPaneli(r: Robota | null, width: number): { text: string; bold?: boolean; dim?: boolean }[] {
  if (r === null) return [{ text: 'Робочу теку, де є pasport.md чи stan.md, не знайдено.', dim: true }]
  const rows: { text: string; bold?: boolean; dim?: boolean }[] = []
  rows.push({ text: obriz(r.nazva ?? 'Робота без назви', width), bold: true })
  rows.push({ text: obriz(r.teka, width), dim: true })
  rows.push({ text: '' })
  rows.push({ text: 'Контрольні точки', bold: true })
  rows.push({ text: r.kts.slice(0, 5).map(k => `${ZNAK[k.status]} КТ${k.n}`).join('  ') })
  rows.push({ text: r.kts.slice(5).map(k => `${ZNAK[k.status]} КТ${k.n}`).join('  ') })
  rows.push({ text: '' })
  rows.push({ text: 'Наряд', bold: true })
  if (r.zadachi.length === 0) rows.push({ text: 'задач немає', dim: true })
  for (const z of r.zadachi) {
    const tail = ` — ${z.status}`
    rows.push({ text: `${z.id} ${obriz(z.zavdannia, Math.max(8, width - z.id.length - tail.length - 1))}${tail}`, dim: /^прийнято/i.test(z.status) })
  }
  rows.push({ text: '' })
  const b = r.zauvazhennia.filter(z => z.klas === 'Б')
  const s = r.zauvazhennia.filter(z => z.klas === 'С')
  const d = r.zauvazhennia.filter(z => z.klas === 'Д')
  rows.push({ text: `Зауваження рецензента${r.zvit === undefined ? '' : ` (${r.zvit})`}`, bold: true })
  if (r.zvit === undefined) rows.push({ text: 'звіту ще немає', dim: true })
  else {
    rows.push({ text: `Б: ${b.length}   С: ${s.length}   Д: ${d.length}` })
    for (const [klas, list] of [['Б', b], ['С', s], ['Д', d]] as const) {
      for (const z of list.slice(0, 4)) rows.push({ text: obriz(`${klas}  ${z.misce}: ${z.problema}`, width) })
      if (list.length > 4) rows.push({ text: `${klas}  і ще ${list.length - 4}`, dim: true })
    }
  }
  rows.push({ text: '' })
  rows.push({ text: `Джерел: ${r.dzherel ?? '—'}, з них 2018 р. і пізніше: ${vidsotok(r.chastka2018)}` })
  rows.push({ text: `Заглушок «[уточнити]»: ${r.utochnyty ?? '—'}` })
  return rows
}

export function panelHooks(on: On, cfg: Cfg) {
  void cfg
  on('ui.render', { component: 'Pane', requestId: PANEL_NAUKA }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const r = await read($, robotaA)
    const width = Math.max(20, (e.props.bodyColumns ?? 60) - 1)
    return (
      <Box flexDirection="column">
        {riadkyPaneli(r, width).map(row => (
          <Text bold={row.bold === true} dimColor={row.dim === true}>{row.text === '' ? ' ' : row.text}</Text>
        ))}
      </Box>
    )
  })
}

// ---------- А6. Slash-команди ----------


const PRAVYLA_KB = (cfg: Cfg) =>
  `Сховище бази знань: ${cfg.vault}. Перед будь-якою дією з ним прочитай CLAUDE.md у його корені. Без окремого дозволу можна лише створювати нові нотатки (Т1–Т4 у 00_Вхідні, Т5 у 50_Проєкти, YouTube у 70_YouTube) з created_by: Claude і verification: не перевірено. Наявні нотатки й .obsidian/ не змінюй.`

async function novitnishyiDocx($: $, teka: string): Promise<string | undefined> {
  const files = await $.fs.list(teka).catch(() => [])
  const docx = files.filter(f => f.kind === 'file' && /\.docx$/i.test(f.name) && !f.name.startsWith('~$'))
  docx.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return docx[0] === undefined ? undefined : join(teka, docx[0].name)
}

async function zriz($: $, cfg: Cfg): Promise<string> {
  await onovytyRobotu($, cfg)
  const r = await read($, robotaA)
  if (r === null) return 'Робочу теку, де є stan.md, не знайдено.'
  const stan = (await chytaty($, join(r.teka, 'stan.md'))) ?? ''
  const ostanni = stan.split('\n').filter(l => l.trim() !== '').slice(-12)
  const zakryti = r.kts.filter(k => k.status === 'закрито').map(k => `КТ${k.n}`)
  return [
    `${r.nazva ?? 'Робота без назви'}`,
    `Етап: ${r.etap ?? '—'}. Поточна точка: ${r.kt ?? '—'}. Закрито: ${zakryti.length === 0 ? 'жодної' : zakryti.join(', ')}.`,
    `Раунд рецензії: ${r.raund ?? '—'}. Ліміт Wiley: ${r.wiley ?? '—'}. Фінальне вичитування: ${r.vychytano ? 'записано' : 'запису немає'}.`,
    `Джерел: ${r.dzherel ?? '—'}, з них 2018 р. і пізніше: ${vidsotok(r.chastka2018)}. Заглушок «[уточнити]»: ${r.utochnyty ?? '—'}.`,
    '',
    'Останні записи stan.md:',
    ...ostanni,
  ].join('\n')
}

export const NAUKA_KOMANDY = ['нова-робота', 'доопрацювання', 'стан', 'перевір-інструменти', 'джерела-kb', 'вичитати', 'супровідні']

export type KomandaModa = { vidpovid?: CommandRunResult; kontekst?: string }

export async function komandaNauky($: $, cfg: Cfg, name: string, args: string): Promise<KomandaModa> {
  const a = args.trim()
  await vstanovytyRezhym($, 'nauka')
  await onovytyStatus($, cfg)
  if (name === 'стан') {
    const text = await zriz($, cfg)
    if (cfg.nauka.panel) void $.ui.open({ id: PANEL_NAUKA, title: 'Хід роботи' })
    return { vidpovid: { text, isTextDisplayOnly: true } }
  }
  if (name === 'нова-робота' || name === 'доопрацювання' || name === 'джерела-kb') {
    const r = await read($, robotaA)
    const tema = name === 'джерела-kb' && a === '' && r?.nazva !== undefined ? `Тема з pasport.md: ${r.nazva}\n` : ''
    return { kontekst: `${tema}${PRAVYLA_KB(cfg)}` }
  }
  if (name === 'вичитати') {
    const teka = (await znaityTeku($)) ?? (await $.session.root())
    const file = a !== '' ? a.replace(/^["']|["']$/g, '') : await novitnishyiDocx($, teka)
    if (file === undefined || !/\.docx$/i.test(file)) return {}
    const v = await perevirDocx($, file, cfg.nauka.zaglushkyBlok)
    const shcho = v.porushennia.length === 0
      ? `Перевірка мода у «${file}» порушень не знайшла.`
      : `Перевірка мода у «${file}» знайшла (виправ під час вичитування):\n${zvedennia(v.porushennia, 30)}`
    return { kontekst: shcho }
  }
  return {}
}
