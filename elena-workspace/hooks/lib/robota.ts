// Розбір робочих файлів конвеєра: pasport.md, naryad.md, stan.md, retsenziia_N.md, dzherela.tsv.

import type { KT, Robota, Zadacha, Zauvazhennia } from '../../types'

export function nazvaRoboty(pasport: string): string | undefined {
  const m = /^\s*Тема\s*:\s*(.+)$/m.exec(pasport)
  const t = m?.[1]?.trim()
  return t === undefined || t === '' || t === '…' || t === '...' ? undefined : t
}

export function zadachiNariadu(naryad: string): Zadacha[] {
  const out: Zadacha[] = []
  for (const line of naryad.split('\n')) {
    if (!/^\s*\|\s*З-\d+/.test(line)) continue
    const cells = line.split('|').slice(1, -1).map(c => c.trim())
    if (cells.length < 4) continue
    out.push({ id: cells[0]!, etap: cells[1] ?? '', zavdannia: cells[3] ?? '', status: cells[cells.length - 1] ?? '' })
  }
  return out
}

export const potochnaKT = (naryad: string) => /Поточна контрольна точка\s*:\s*(КТ\s?\d)/i.exec(naryad)?.[1]?.replace(/\s/g, '')

export function zakrytiKT(stan: string): number[] {
  const set = new Set<number>()
  const re = /КТ\s?(\d)\s+закрит/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(stan)) !== null) set.add(Number(m[1]))
  return [...set].sort((a, b) => a - b)
}

function ostannie(re: RegExp, text: string): RegExpExecArray | undefined {
  let last: RegExpExecArray | undefined
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  let m: RegExpExecArray | null
  while ((m = g.exec(text)) !== null) last = m
  return last
}

export function raundStanu(stan: string): number | undefined {
  const m = ostannie(/раунд[а-яії]*(?:\s+рецензі[а-яії]*)?\s*[:№-]?\s*(\d+)/i, stan)
  return m === undefined ? undefined : Number(m[1])
}

export function zalyshokWiley(stan: string): number | undefined {
  let value: number | undefined
  for (const line of stan.split('\n')) {
    if (!/wiley|scholar\s*gateway/i.test(line)) continue
    const m = /залиш\w*[^\d\n]{0,40}?(\d+)/i.exec(line)
    if (m !== null) value = Number(m[1])
  }
  return value
}

export function etapRoboty(zadachi: Zadacha[], stan: string): string | undefined {
  const first = zadachi.find(z => !/^прийнято/i.test(z.status))
  if (first !== undefined && first.etap !== '') return first.etap
  return ostannie(/етап\s+(\d+а?)/i, stan)?.[1]
}

export function zauvazhenniaZvitu(zvit: string): Zauvazhennia[] {
  const out: Zauvazhennia[] = []
  for (const line of zvit.split('\n')) {
    if (!line.trim().startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map(c => c.trim())
    const i = cells.findIndex(c => /^[БСДC]$/.test(c))
    if (i < 0) continue
    const klas = (cells[i] === 'C' ? 'С' : cells[i]) as Zauvazhennia['klas']
    out.push({ klas, misce: cells[i + 1] ?? '', problema: cells[i + 2] ?? '' })
  }
  return out
}

export function dzherelaStat(tsv: string): { dzherel: number; chastka2018?: number } {
  let dzherel = 0
  let zRokom = 0
  let svizhi = 0
  for (const line of tsv.split('\n')) {
    const f = line.split('\t')
    if (!/^\s*\d+/.test(f[0] ?? '')) continue
    dzherel++
    const y = /\b(19|20)\d{2}\b/.exec(f[2] ?? '') ?? /\b(19|20)\d{2}\b/.exec(f[1] ?? '')
    if (y === null) continue
    zRokom++
    if (Number(y[0]) >= 2018) svizhi++
  }
  return { dzherel, chastka2018: zRokom === 0 ? undefined : (svizhi / zRokom) * 100 }
}

export const kilkistUtochnyty = (text: string) => (text.match(/\[уточнити[^\]]*\]/gi) ?? []).length

export function kontrolniTochky(zakryti: number[], potochna: string | undefined): KT[] {
  const cur = potochna === undefined ? undefined : Number(potochna.replace(/\D/g, ''))
  return Array.from({ length: 10 }, (_, n) => ({
    n,
    status: zakryti.includes(n) ? 'закрито' : n === cur ? 'поточна' : 'відкрита',
  }))
}

export function porozhniaRobota(teka: string): Robota {
  return { teka, kts: kontrolniTochky([], undefined), zadachi: [], zauvazhennia: [], vychytano: false }
}
