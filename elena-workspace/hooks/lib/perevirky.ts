// Чисті перевірки без доступу до $: тексту, шляхів, джерел і YAML.

export type Porushennia = { vyd: string; misce: string; bezsumnivne: boolean }

const BIB_START = /^\s*(список\s+(використаних\s+)?(джерел|літератури)|використані\s+джерела|references|бібліографія|література)\s*:?\s*$/i
const APPENDIX = /^\s*(додатки|додаток\s+[а-яґєії0-9])/i
const URL_RE = /https?:\/\/\S+|www\.\S+/gi
const DOI_RE = /\b(doi:\s*)?10\.\d{4,9}\/\S+/gi
const LIST_MARK = /^\s*([-–—•]|\d+[.)]|[а-яґєіїa-z][)])\s/i

const uryvok = (s: string, at: number, len = 1) => {
  const from = Math.max(0, at - 25)
  const to = Math.min(s.length, at + len + 25)
  return `${from > 0 ? '…' : ''}${s.slice(from, to).replace(/\s+/g, ' ').trim()}${to < s.length ? '…' : ''}`
}

const masked = (s: string, re: RegExp) => s.replace(re, m => ' '.repeat(m.length))

const words = (s: string) => s.split(/\s+/).filter(w => /[\p{L}\d]/u.test(w)).length

const latinMostly = (s: string) => {
  const lat = (s.match(/[A-Za-z]/g) ?? []).length
  const cyr = (s.match(/[А-Яа-яҐґЄєІіЇї]/g) ?? []).length
  return lat > cyr
}

function semicolons(p: string, n: number, out: Porushennia[]) {
  let s = masked(p, URL_RE)
  s = s.replace(/\[[^\]]*\]/g, m => ' '.repeat(m.length)).replace(/\([^)]*\)/g, m => ' '.repeat(m.length))
  s = s.replace(/(\d)\.(?=\d)/g, '$1,')
  for (let i = s.indexOf(';'); i >= 0; i = s.indexOf(';', i + 1)) {
    const before = s.slice(0, i)
    const start = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'), before.lastIndexOf('…')) + 1
    const left = before.slice(start)
    const rest = s.slice(i + 1)
    const endRel = rest.search(/[.!?…;]/)
    const right = endRel < 0 ? rest : rest.slice(0, endRel)
    const lw = words(left)
    const rw = words(right)
    if (lw < 3 || rw < 3) continue
    const startsUpper = /^[\s«"„“(]*\p{Lu}/u.test(right)
    const isList = left.includes(':') || LIST_MARK.test(p)
    out.push({
      vyd: 'крапка з комою між реченнями',
      misce: `абз. ${n}: «${uryvok(p, i)}»`,
      bezsumnivne: startsUpper && !isList,
    })
  }
}

function decimals(p: string, n: number, out: Porushennia[]) {
  if (latinMostly(p)) return
  const s = masked(masked(p, URL_RE), DOI_RE)
  const re = /(?<![\d.,])(\d+)\.(\d+)(?![\d.])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    const before = s.slice(Math.max(0, m.index - 14), m.index)
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 3)
    if (/(рис|табл|розд|підрозд|пп?|пункт[а-яґєії]*|§|додат[а-яґєії]*|формул[а-яґєії]*|схем[а-яґєії]*|глав[а-яґєії]*|част[а-яґєії]*|с|рр?|т|вип|№)\.?\s*$/i.test(before)) continue
    if (s.slice(0, m.index).trim() === '') continue
    const isSure = /^\s?[%‰]/.test(after) || /([=<>≈±]|\b(M|SD|r|p|t|F|n|N|df)\s*[=<>])\s*$/.test(before) ||
      /(дорівню\S*|станов\S*|склада\S*|склав\S*|сяга\S*|сягнув\S*|середньому)\s*$/i.test(before)
    out.push({ vyd: 'десяткова крапка', misce: `абз. ${n}: «${uryvok(p, m.index, m[0].length)}»`, bezsumnivne: isSure })
  }
}

// Перевіряє текст фінального файлу за правилами Правопису 2019 і конвеєра.
export function perevirTekst(text: string, zaglushkyBlok = false): Porushennia[] {
  const out: Porushennia[] = []
  const paras = text.split(/\n+/)
  let inBib = false
  paras.forEach((p, idx) => {
    const n = idx + 1
    if (BIB_START.test(p)) inBib = true
    else if (inBib && APPENDIX.test(p)) inBib = false
    for (let i = p.indexOf('·'); i >= 0; i = p.indexOf('·', i + 1)) {
      out.push({ vyd: 'серединна крапка «·»', misce: `абз. ${n}: «${uryvok(p, i)}»`, bezsumnivne: true })
    }
    const clean = masked(masked(p, URL_RE), DOI_RE)
    const zero = /(?<![\d,.])\d+,0+(?!\d)/g
    let m: RegExpExecArray | null
    while ((m = zero.exec(clean)) !== null) {
      out.push({ vyd: '«,0» у цілому значенні', misce: `абз. ${n}: «${uryvok(p, m.index, m[0].length)}»`, bezsumnivne: true })
    }
    const ru = /[ыэъёЫЭЪЁ]/g
    while ((m = ru.exec(p)) !== null) {
      out.push({ vyd: `літера «${m[0]}»`, misce: `абз. ${n}: «${uryvok(p, m.index)}»`, bezsumnivne: true })
    }
    const stub = /\[уточнити[^\]]*\]/gi
    while ((m = stub.exec(p)) !== null) {
      out.push({ vyd: 'заглушка «[уточнити]»', misce: `абз. ${n}: «${uryvok(p, m.index, m[0].length)}»`, bezsumnivne: zaglushkyBlok })
    }
    if (!inBib && !BIB_START.test(p)) {
      semicolons(p, n, out)
      decimals(p, n, out)
    }
  })
  return out
}

// Чи є в stan.md запис про виконане фінальне вичитування.
export function vychytanoZapysano(stan: string): boolean {
  for (const line of stan.split('\n')) {
    if (/КТ\s?7\s+закрит/i.test(line)) return true
    if (!/вичитуван/i.test(line)) continue
    if (/\bне\s+(виконано|завершено|проведено)|не\s+вичитано|очіку/i.test(line)) continue
    if (/(виконано|завершено|проведено|готово|закрито|дотримано|✅|✔|\[x\])/i.test(line)) return true
  }
  return false
}

export function zvedennia(porushennia: Porushennia[], limit = 12): string {
  const lines = porushennia.slice(0, limit).map(p => `- ${p.vyd}, ${p.misce}`)
  if (porushennia.length > limit) lines.push(`- і ще ${porushennia.length - limit}`)
  return lines.join('\n')
}

// --- шляхи ---

export const normPath = (p: string) =>
  p.normalize('NFC').replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '').toLowerCase()

// Шлях усередині сховища без кореня, або undefined.
export function vidnosnoSkhovyshcha(path: string, vault: string): string | undefined {
  const p = normPath(path)
  const v = normPath(vault)
  if (v === '') return undefined
  if (p === v) return ''
  if (!p.startsWith(v + '/')) return undefined
  const orig = path.normalize('NFC').replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '')
  return orig.slice(orig.length - (p.length - v.length - 1))
}

export const DOZVOLENI = ['00_Вхідні', '50_Проєкти', '70_YouTube']

export const basename = (p: string) => p.replace(/\\/g, '/').split('/').pop() ?? p
export const dirname = (p: string) => {
  const s = p.replace(/\\/g, '/')
  const i = s.lastIndexOf('/')
  return i <= 0 ? (i === 0 ? '/' : '.') : s.slice(0, i)
}

// --- YAML ---

export function frontmatter(text: string): Record<string, string> | undefined {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/.exec(text)
  if (m === null) return undefined
  const out: Record<string, string> = {}
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    const kv = /^([A-Za-z_Ѐ-ӿ][\wЀ-ӿ-]*)\s*:\s*(.*)$/.exec(line)
    if (kv === null) continue
    out[kv[1]!.toLowerCase()] = (kv[2] ?? '').trim().replace(/^["']|["']$/g, '').trim()
  }
  return out
}

export function yamlNotatkyClaude(text: string): string | undefined {
  const fm = frontmatter(text)
  if (fm === undefined) return 'немає блоку YAML'
  const bad: string[] = []
  if ((fm['created_by'] ?? '') !== 'Claude') bad.push('created_by: Claude')
  if ((fm['verification'] ?? '').toLowerCase() !== 'не перевірено') bad.push('verification: не перевірено')
  return bad.length === 0 ? undefined : `бракує полів ${bad.join(' і ')}`
}

// --- джерела ---

const PLATFORMY = [
  'elibrary.ru', 'cyberleninka.ru', 'cyberleninka.org', 'dissercat.com', 'rusneb.ru', 'rsl.ru', 'naukaru.ru',
  'lanbook.com', 'e.lanbook.com', 'urait.ru', 'znanium.com', 'znanium.ru', 'sciup.org', 'vak.minobrnauki.gov.ru',
  'ras.ru', 'mathnet.ru', 'nauka-rastudent.ru', 'moluch.ru', 'scienceforum.ru', 'scholar.urfu.ru', 'msu.ru',
]

export function khost(url: string): string | undefined {
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/\s]*@)?([^/:?#\s]+)/i.exec(url.trim())
  return m?.[1]?.toLowerCase().replace(/\.$/, '')
}

// Причина, з якої домен вважається російським чи білоруським, або undefined.
export function rosiiskyiDomen(host: string): string | undefined {
  const h = host.toLowerCase()
  if (/\.(ru|su|by|рф|xn--p1ai|бел|xn--90ais)$/.test(h)) return `домен ${h}`
  const p = PLATFORMY.find(x => h === x || h.endsWith('.' + x))
  return p === undefined ? undefined : `російська платформа ${p}`
}

// Знаходить у тексті URL і DOI-посилання з російськими чи білоруськими доменами.
export function rosiiskiPosylannia(text: string): { host: string; prychyna: string; riadok: number }[] {
  const out: { host: string; prychyna: string; riadok: number }[] = []
  text.split('\n').forEach((line, i) => {
    const re = /\b(?:https?:\/\/|www\.)[^\s\t|"'<>)]+|\b(?:[a-z0-9-]+\.)+(?:ru|su|by|рф)\b(?:\/[^\s\t|]*)?|\b(?:[a-z0-9-]+\.)*(?:elibrary|cyberleninka|dissercat|lanbook|znanium|urait)\.[a-z]{2,}/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
      const host = khost(m[0])
      if (host === undefined) continue
      const prychyna = rosiiskyiDomen(host)
      if (prychyna !== undefined) out.push({ host, prychyna, riadok: i + 1 })
    }
  })
  return out
}

// --- формат чисел за Правописом ---

export function chyslo(n: number, digits = 1): string {
  const s = n.toFixed(digits).replace('.', ',')
  return s.replace(/,0+$/, '')
}
