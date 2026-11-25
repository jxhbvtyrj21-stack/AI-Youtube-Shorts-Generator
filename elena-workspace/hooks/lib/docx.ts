// Витягування тексту з .docx без Node: власне читання ZIP і розпакування DEFLATE.

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

type Huff = { count: Uint16Array; symbol: Uint16Array }

function build(lengths: ArrayLike<number>, n: number): Huff {
  const count = new Uint16Array(16)
  const symbol = new Uint16Array(n)
  for (let i = 0; i < n; i++) count[lengths[i] ?? 0]! += 1
  count[0] = 0
  const offs = new Uint16Array(16)
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1]! + count[i - 1]!
  for (let i = 0; i < n; i++) {
    const len = lengths[i] ?? 0
    if (len !== 0) {
      symbol[offs[len]!] = i
      offs[len]! += 1
    }
  }
  return { count, symbol }
}

export function inflateRaw(src: Uint8Array, sizeHint = 0): Uint8Array {
  let pos = 0
  let bitbuf = 0
  let bitcnt = 0
  let out = new Uint8Array(Math.max(sizeHint, src.length * 4, 1024))
  let len = 0

  const ensure = (n: number) => {
    if (len + n <= out.length) return
    const bigger = new Uint8Array(Math.max(out.length * 2, len + n))
    bigger.set(out.subarray(0, len))
    out = bigger
  }
  const bits = (n: number) => {
    while (bitcnt < n) {
      if (pos >= src.length) throw new Error('inflate: несподіваний кінець даних')
      bitbuf |= src[pos++]! << bitcnt
      bitcnt += 8
    }
    const v = bitbuf & ((1 << n) - 1)
    bitbuf >>>= n
    bitcnt -= n
    return v
  }
  const decode = (h: Huff) => {
    let code = 0
    let first = 0
    let index = 0
    for (let l = 1; l < 16; l++) {
      code |= bits(1)
      const c = h.count[l]!
      if (code - c < first) return h.symbol[index + (code - first)]!
      index += c
      first += c
      first <<= 1
      code <<= 1
    }
    throw new Error('inflate: хибний код')
  }
  const codes = (lit: Huff, dist: Huff) => {
    for (;;) {
      const sym = decode(lit)
      if (sym < 256) {
        ensure(1)
        out[len++] = sym
      } else if (sym === 256) {
        return
      } else {
        const li = sym - 257
        if (li >= 29) throw new Error('inflate: хибна довжина')
        const n = LBASE[li]! + bits(LEXT[li]!)
        const di = decode(dist)
        if (di >= 30) throw new Error('inflate: хибна відстань')
        const d = DBASE[di]! + bits(DEXT[di]!)
        if (d > len) throw new Error('inflate: відстань поза даними')
        ensure(n)
        for (let i = 0; i < n; i++) {
          out[len] = out[len - d]!
          len++
        }
      }
    }
  }

  let fixedLit: Huff | undefined
  let fixedDist: Huff | undefined
  let last = 0
  do {
    last = bits(1)
    const type = bits(2)
    if (type === 0) {
      bitbuf = 0
      bitcnt = 0
      if (pos + 4 > src.length) throw new Error('inflate: несподіваний кінець даних')
      const n = src[pos]! | (src[pos + 1]! << 8)
      pos += 4
      if (pos + n > src.length) throw new Error('inflate: несподіваний кінець даних')
      ensure(n)
      out.set(src.subarray(pos, pos + n), len)
      len += n
      pos += n
    } else if (type === 1) {
      if (fixedLit === undefined || fixedDist === undefined) {
        const l = new Uint8Array(288)
        for (let i = 0; i < 144; i++) l[i] = 8
        for (let i = 144; i < 256; i++) l[i] = 9
        for (let i = 256; i < 280; i++) l[i] = 7
        for (let i = 280; i < 288; i++) l[i] = 8
        fixedLit = build(l, 288)
        fixedDist = build(new Uint8Array(30).fill(5), 30)
      }
      codes(fixedLit, fixedDist)
    } else if (type === 2) {
      const nlen = bits(5) + 257
      const ndist = bits(5) + 1
      const ncode = bits(4) + 4
      const lengths = new Uint8Array(320)
      for (let i = 0; i < ncode; i++) lengths[ORDER[i]!] = bits(3)
      const lencode = build(lengths, 19)
      const all = new Uint8Array(nlen + ndist)
      let i = 0
      while (i < nlen + ndist) {
        const sym = decode(lencode)
        if (sym < 16) {
          all[i++] = sym
        } else {
          let rep = 0
          let val = 0
          if (sym === 16) {
            if (i === 0) throw new Error('inflate: повтор без попереднього')
            val = all[i - 1]!
            rep = 3 + bits(2)
          } else if (sym === 17) {
            rep = 3 + bits(3)
          } else {
            rep = 11 + bits(7)
          }
          if (i + rep > nlen + ndist) throw new Error('inflate: забагато довжин')
          while (rep-- > 0) all[i++] = val
        }
      }
      codes(build(all.subarray(0, nlen), nlen), build(all.subarray(nlen), ndist))
    } else {
      throw new Error('inflate: хибний тип блоку')
    }
  } while (last === 0)

  return out.subarray(0, len)
}

export type ByteReader = (offset: number, length: number) => Promise<Uint8Array>

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8)
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0

// Повертає байти одного файлу з ZIP-архіву або undefined, якщо його немає.
export async function readZipEntry(read: ByteReader, size: number, name: string): Promise<Uint8Array | undefined> {
  const tailLen = Math.min(size, 65557)
  const tail = await read(size - tailLen, tailLen)
  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tail, i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('docx: не знайдено каталог ZIP')
  const cdSize = u32(tail, eocd + 12)
  const cdOffset = u32(tail, eocd + 16)
  const cd = await read(cdOffset, cdSize)
  const decoder = new TextDecoder()
  let p = 0
  while (p + 46 <= cd.length && u32(cd, p) === 0x02014b50) {
    const method = u16(cd, p + 10)
    const compSize = u32(cd, p + 20)
    const rawSize = u32(cd, p + 24)
    const nameLen = u16(cd, p + 28)
    const extraLen = u16(cd, p + 30)
    const commentLen = u16(cd, p + 32)
    const local = u32(cd, p + 42)
    const entryName = decoder.decode(cd.subarray(p + 46, p + 46 + nameLen))
    if (entryName === name) {
      const head = await read(local, 30)
      if (u32(head, 0) !== 0x04034b50) throw new Error('docx: пошкоджений локальний заголовок')
      const start = local + 30 + u16(head, 26) + u16(head, 28)
      const data = await read(start, compSize)
      if (method === 0) return data
      if (method === 8) return inflateRaw(data, rawSize)
      throw new Error(`docx: непідтримуваний метод стиснення ${method}`)
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return undefined
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[ent.toLowerCase()] ?? m
  })
}

// Текст document.xml: абзац на рядок, видалений у рецензуванні текст пропущено.
export function documentXmlToText(xml: string): string {
  const paragraphs: string[] = []
  const body = xml.replace(/<w:delText[^>]*>[\s\S]*?<\/w:delText>/g, '')
  for (const para of body.split(/<\/w:p>/)) {
    let text = ''
    const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:noBreakHyphen\/>|<w:br\/>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(para)) !== null) {
      if (m[1] !== undefined) text += decodeXml(m[1])
      else if (m[0] === '<w:tab/>') text += '\t'
      else if (m[0] === '<w:noBreakHyphen/>') text += '-'
      else text += ' '
    }
    if (text.trim() !== '') paragraphs.push(text)
  }
  return paragraphs.join('\n')
}

export async function docxText(read: ByteReader, size: number): Promise<string> {
  const xml = await readZipEntry(read, size, 'word/document.xml')
  if (xml === undefined) throw new Error('docx: немає word/document.xml')
  return documentXmlToText(new TextDecoder().decode(xml))
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let buf = 0
  let bitsHeld = 0
  let o = 0
  for (let i = 0; i < clean.length; i++) {
    buf = (buf << 6) | B64.indexOf(clean[i]!)
    bitsHeld += 6
    if (bitsHeld >= 8) {
      bitsHeld -= 8
      out[o++] = (buf >> bitsHeld) & 0xff
    }
  }
  return out.subarray(0, o)
}
