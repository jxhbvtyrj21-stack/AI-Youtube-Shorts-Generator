import { atom, read, update } from 'claude-code'
import type { EngineInterface, ToolCallResult } from 'claude-code'

import type { Kanaly, Potochne, Rezhym, Robota, Video } from '../types'
import { docxText, fromBase64 } from './lib/docx'
import { pisliaZminyRezhymu } from './vyhliad'
import type { Porushennia } from './lib/perevirky'
import { basename, chyslo, dirname, frontmatter, perevirTekst, vychytanoZapysano } from './lib/perevirky'
import {
  dzherelaStat, etapRoboty, kilkistUtochnyty, kontrolniTochky, nazvaRoboty, potochnaKT, raundStanu,
  zadachiNariadu, zakrytiKT, zalyshokWiley, zauvazhenniaZvitu,
} from './lib/robota'

export type $ = EngineInterface

export type Rishennia = { deny?: string; warn?: string }

export function zKontekstom(r: ToolCallResult, warn: string | undefined): ToolCallResult {
  if (warn === undefined || r.deny !== undefined) return r
  return { ...r, context: [...(r.context ?? []), warn] }
}

export type Cfg = {
  vault: string
  kanaly: string[]
  nauka: { vydacha: boolean; zaglushkyBlok: boolean; kb: boolean; dzherela: boolean; panel: boolean; komandy: boolean }
  youtube: { komandy: boolean; panel: boolean; zakhyst: boolean }
  vyhliad: { temy: boolean; baner: boolean }
}

export const robotaA = atom({ plugin: 'elena-workspace', key: 'robota' } as const, null, { shape: 'robota-1' })
export const kbA = atom({ plugin: 'elena-workspace', key: 'kb' } as const, null)
export const kanalyA = atom({ plugin: 'elena-workspace', key: 'kanaly' } as const, null, { shape: 'kanaly-1' })
export const rezhymA = atom({ plugin: 'elena-workspace', key: 'rezhym' } as const, 'nauka')
export const potochneA = atom({ plugin: 'elena-workspace', key: 'potochne' } as const, {}, { shape: 'potochne-1' })

export const PANEL_NAUKA = 'elena-khid-roboty'
export const PANEL_YOUTUBE = 'elena-kanaly'

// Збій мода не зупиняє роботу: запис у журнал у сховищі мода, без повідомлень.
export async function zbii($: $, de: string, err: unknown): Promise<void> {
  try {
    const list = ((await $.store.get('zhurnal')) as { chas: string; de: string; pomylka: string }[] | undefined) ?? []
    const pomylka = String(err instanceof Error ? err.message : err).slice(0, 500)
    list.push({ chas: new Date(await $.clock.now()).toISOString(), de, pomylka })
    await $.store.set('zhurnal', list.slice(-200))
  } catch {
    // журнал недоступний: дію вже пропущено
  }
}

export async function chytaty($: $, path: string): Promise<string | undefined> {
  try {
    return await $.fs.read(path)
  } catch {
    return undefined
  }
}

export async function isnuie($: $, path: string): Promise<boolean | undefined> {
  try {
    return await $.fs.exists(path)
  } catch {
    return undefined
  }
}

export const join = (a: string, b: string) => (a.endsWith('/') || a.endsWith('\\') ? a + b : `${a}/${b}`)

// --- .docx ---

const MiB4 = 4 * 1024 * 1024

export async function tekstDocx($: $, path: string): Promise<string> {
  const { size } = await $.fs.stat(path)
  const reader = async (offset: number, length: number) => {
    const parts: Uint8Array[] = []
    let done = 0
    while (done < length) {
      const n = Math.min(MiB4, length - done)
      const { base64 } = await $.fs.read(path, { as: 'bytes', offset: offset + done, length: n })
      parts.push(fromBase64(base64))
      done += n
    }
    if (parts.length === 1) return parts[0]!
    const all = new Uint8Array(length)
    let o = 0
    for (const p of parts) {
      all.set(p, o)
      o += p.length
    }
    return all
  }
  return docxText(reader, size)
}

export type DocxVysnovok = {
  porushennia: Porushennia[]
  stan?: string
  vychytano?: boolean
  blokuvaty: boolean
}

export async function znaityStan($: $, start: string): Promise<string | undefined> {
  let dir = start
  for (let i = 0; i < 3; i++) {
    const p = join(dir, 'stan.md')
    if (await isnuie($, p)) return p
    const up = dirname(dir)
    if (up === dir || up === '.' || up === '/') break
    dir = up
  }
  const robota = await read($, robotaA)
  if (robota !== null) {
    const p = join(robota.teka, 'stan.md')
    if (await isnuie($, p)) return p
  }
  return undefined
}

export async function perevirDocx($: $, path: string, zaglushkyBlok = false): Promise<DocxVysnovok> {
  const tekst = await tekstDocx($, path)
  const porushennia = perevirTekst(tekst, zaglushkyBlok)
  const stan = await znaityStan($, dirname(path))
  const vychytano = stan === undefined ? undefined : vychytanoZapysano((await chytaty($, stan)) ?? '')
  const sure = porushennia.some(p => p.bezsumnivne)
  return { porushennia, stan, vychytano, blokuvaty: stan !== undefined && (sure || vychytano === false) }
}

// --- робоча тека ---

async function maRobotu($: $, dir: string): Promise<boolean> {
  return (await isnuie($, join(dir, 'stan.md'))) === true || (await isnuie($, join(dir, 'pasport.md'))) === true
}

export async function pamiatatyTeku($: $, dir: string): Promise<void> {
  try {
    await $.store.set('teka', dir)
  } catch (err) {
    await zbii($, 'пам\'ять теки', err)
  }
}

export async function znaityTeku($: $): Promise<string | undefined> {
  const zapam = (await $.store.get('teka')) as string | undefined
  if (zapam !== undefined && (await maRobotu($, zapam))) return zapam
  const root = await $.session.root()
  if (await maRobotu($, root)) return root
  let best: { dir: string; mtime: number } | undefined
  const entries = await $.fs.list(root).catch(() => [])
  for (const ent of entries.slice(0, 200)) {
    if (ent.kind !== 'dir' || ent.name.startsWith('.')) continue
    const dir = join(root, ent.name)
    const stan = join(dir, 'stan.md')
    const st = await $.fs.stat(stan).catch(() => undefined)
    if (st !== undefined && (best === undefined || st.mtimeMs > best.mtime)) best = { dir, mtime: st.mtimeMs }
  }
  return best?.dir
}

export const RABOCHI = /(^|[\\/])(stan\.md|naryad\.md|pasport\.md|dzherela\.tsv|retsenziia_\d+\.md|tekst\.md)$/i

export async function zibratyRobotu($: $, teka: string): Promise<Robota> {
  const [pasport, naryad, stan, dzherela, tekst] = await Promise.all([
    chytaty($, join(teka, 'pasport.md')),
    chytaty($, join(teka, 'naryad.md')),
    chytaty($, join(teka, 'stan.md')),
    chytaty($, join(teka, 'dzherela.tsv')),
    chytaty($, join(teka, 'tekst.md')),
  ])
  const zadachi = zadachiNariadu(naryad ?? '')
  const kt = potochnaKT(naryad ?? '')
  const files = await $.fs.list(teka).catch(() => [])
  let zvitN = -1
  for (const f of files) {
    const m = /^retsenziia_(\d+)\.md$/i.exec(f.name)
    if (m !== null && Number(m[1]) > zvitN) zvitN = Number(m[1])
  }
  const zvit = zvitN < 0 ? undefined : `retsenziia_${zvitN}.md`
  const zvitText = zvit === undefined ? '' : ((await chytaty($, join(teka, zvit))) ?? '')
  const stat = dzherelaStat(dzherela ?? '')
  const raund = raundStanu(stan ?? '') ?? (zvitN < 0 ? undefined : zvitN)
  const robota: Robota = {
    teka,
    kts: kontrolniTochky(zakrytiKT(stan ?? ''), kt),
    zadachi,
    zauvazhennia: zauvazhenniaZvitu(zvitText),
    vychytano: vychytanoZapysano(stan ?? ''),
  }
  const nazva = nazvaRoboty(pasport ?? '')
  const etap = etapRoboty(zadachi, stan ?? '')
  const wiley = zalyshokWiley(stan ?? '')
  if (nazva !== undefined) robota.nazva = nazva
  if (etap !== undefined) robota.etap = etap
  if (kt !== undefined) robota.kt = kt
  if (raund !== undefined) robota.raund = raund
  if (wiley !== undefined) robota.wiley = wiley
  if (zvit !== undefined) robota.zvit = zvit
  if (dzherela !== undefined) robota.dzherel = stat.dzherel
  if (stat.chastka2018 !== undefined) robota.chastka2018 = stat.chastka2018
  if (tekst !== undefined) robota.utochnyty = kilkistUtochnyty(tekst)
  return robota
}

export async function spovistyty($: $, text: string): Promise<void> {
  $.ui.toast(text)
  await $.ui.notify(text, { title: 'Робочий простір' }).catch(() => undefined)
}

export function zapyty(n: number): string {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return 'запит'
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'запити'
  return 'запитів'
}

export async function onovytyRobotu($: $, cfg: Cfg): Promise<void> {
  const teka = await znaityTeku($)
  const prev = await read($, robotaA)
  if (teka === undefined) {
    if (prev !== null) await update($, robotaA, () => null)
    return
  }
  const robota = await zibratyRobotu($, teka)
  await update($, robotaA, () => robota)
  if (!cfg.nauka.panel || prev === null || prev.teka !== robota.teka) return
  const bulo = new Set(prev.kts.filter(k => k.status === 'закрито').map(k => k.n))
  for (const k of robota.kts) {
    if (k.status === 'закрито' && !bulo.has(k.n)) await spovistyty($, `Закрито контрольну точку КТ${k.n}`)
  }
  if (robota.wiley !== undefined && robota.wiley < 5 && robota.wiley !== prev.wiley) {
    await spovistyty($, `Ліміт Wiley: лишилося ${robota.wiley} ${zapyty(robota.wiley)}`)
  }
}

export async function onovytyKB($: $, cfg: Cfg): Promise<void> {
  const ok = (await isnuie($, cfg.vault)) === true
  const prev = await read($, kbA)
  await update($, kbA, () => ok)
  if (cfg.nauka.panel && !ok && prev !== false) await spovistyty($, 'База знань недоступна')
}

// --- YouTube ---

const ETAPY: [RegExp, Video['etap']][] = [
  [/опублік|published|вийшло/i, 'опубліковано'],
  [/монтаж|зйом|запис|edit/i, 'монтаж'],
  [/сценар|script/i, 'сценарій'],
  [/іде|idea|задум/i, 'ідея'],
]

export function videoZNotatky(file: string, text: string, kanaly: string[]): Video | undefined {
  const fm = frontmatter(text)
  if (fm === undefined) return undefined
  const st = fm['status'] ?? fm['stage'] ?? fm['etap'] ?? fm['етап'] ?? ''
  const etap = ETAPY.find(([re]) => re.test(st))?.[1]
  if (etap === undefined) return undefined
  const zShliakhu = kanaly.find(k => file.replace(/\\/g, '/').split('/').includes(k))
  const v: Video = {
    file,
    nazva: fm['title'] ?? basename(file).replace(/\.md$/i, ''),
    kanal: fm['channel'] ?? fm['kanal'] ?? fm['канал'] ?? zShliakhu ?? 'без каналу',
    etap,
  }
  const ctr = fm['ctr']
  const ut = fm['retention'] ?? fm['utrymannia'] ?? fm['avg_view_percentage']
  const pv = fm['views'] ?? fm['perehliady']
  if (ctr !== undefined && ctr !== '') v.ctr = ctr
  if (ut !== undefined && ut !== '') v.utrymannia = ut
  if (pv !== undefined && pv !== '') v.perehliady = pv
  return v
}

const kesh = new Map<string, { mtime: number; video: Video | undefined }>()

async function zibratyMd($: $, dir: string, depth: number, out: { path: string; mtime: number }[]): Promise<void> {
  if (depth > 4 || out.length >= 400) return
  const entries = await $.fs.list(dir).catch(() => [])
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue
    const p = join(dir, ent.name)
    if (ent.kind === 'dir') await zibratyMd($, p, depth + 1, out)
    else if (ent.kind === 'file' && /\.md$/i.test(ent.name)) out.push({ path: p, mtime: ent.mtimeMs })
    if (out.length >= 400) return
  }
}

export async function onovytyKanaly($: $, cfg: Cfg): Promise<void> {
  const root = join(cfg.vault, '70_YouTube')
  if ((await isnuie($, root)) !== true) {
    await update($, kanalyA, () => ({ kanaly: cfg.kanaly, video: [], dostupno: false }))
    return
  }
  const files: { path: string; mtime: number }[] = []
  await zibratyMd($, root, 0, files)
  const video: Video[] = []
  for (const f of files) {
    const hit = kesh.get(f.path)
    if (hit !== undefined && hit.mtime === f.mtime) {
      if (hit.video !== undefined) video.push(hit.video)
      continue
    }
    const text = (await chytaty($, f.path)) ?? ''
    const v = videoZNotatky(f.path, text.slice(0, 20000), cfg.kanaly)
    kesh.set(f.path, { mtime: f.mtime, video: v })
    if (v !== undefined) video.push(v)
  }
  const kanaly = [...new Set([...cfg.kanaly, ...video.map(v => v.kanal)])]
  const value: Kanaly = { kanaly, video, dostupno: true }
  await update($, kanalyA, () => value)
}

// --- режим і рядок стану ---

export async function vstanovytyRezhym($: $, r: Rezhym): Promise<void> {
  if ((await read($, rezhymA)) === r) return
  await update($, rezhymA, () => r)
  await pisliaZminyRezhymu($).catch(err => zbii($, 'зміна режиму', err))
}

export async function vstanovytyPotochne($: $, p: Potochne): Promise<void> {
  await update($, potochneA, old => ({ ...old, ...p }))
}

const abo = (v: string | number | undefined) => (v === undefined || v === '' ? '—' : String(v))

export async function onovytyStatus($: $, cfg: Cfg): Promise<void> {
  const rezhym = await read($, rezhymA)
  if (rezhym === 'youtube') {
    if (!cfg.youtube.panel) return $.ui.status(undefined)
    const p = await read($, potochneA)
    return $.ui.status(`YouTube | канал: ${abo(p.kanal)} | відео: ${abo(p.video)} | етап: ${abo(p.etap)}`)
  }
  if (!cfg.nauka.panel) return $.ui.status(undefined)
  const r = await read($, robotaA)
  const kb = await read($, kbA)
  const kbText = kb === null ? '—' : kb ? 'доступна' : 'недоступна'
  if (r === null) return $.ui.status(`Наука | роботу не знайдено | база знань: ${kbText}`)
  const nazva = r.nazva === undefined ? 'без назви' : r.nazva.length > 40 ? `${r.nazva.slice(0, 39)}…` : r.nazva
  $.ui.status(
    `${nazva} | етап ${abo(r.etap)} | ${abo(r.kt)} | рецензія: раунд ${abo(r.raund)} | Wiley: ${abo(r.wiley)} | база знань: ${kbText}`,
  )
}

export const vidsotok = (n: number | undefined) => (n === undefined ? '—' : `${chyslo(n)} %`)

export function shliakhyDocx(command: string): string[] {
  const out: string[] = []
  const re = /"([^"]+\.docx)"|'([^']+\.docx)'|((?:[A-Za-z]:)?[^\s"'|;&<>]+\.docx)\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(command)) !== null) out.push(m[1] ?? m[2] ?? m[3] ?? '')
  return out.filter(p => p !== '')
}
