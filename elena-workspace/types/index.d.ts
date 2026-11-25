export type KT = { n: number; status: 'закрито' | 'поточна' | 'відкрита' }

export type Zadacha = { id: string; etap: string; zavdannia: string; status: string }

export type Zauvazhennia = { klas: 'Б' | 'С' | 'Д'; misce: string; problema: string }

export type Robota = {
  teka: string
  nazva?: string
  etap?: string
  kt?: string
  raund?: number
  wiley?: number
  kts: KT[]
  zadachi: Zadacha[]
  zauvazhennia: Zauvazhennia[]
  zvit?: string
  dzherel?: number
  chastka2018?: number
  utochnyty?: number
  vychytano: boolean
}

export type Video = {
  file: string
  nazva: string
  kanal: string
  etap: 'ідея' | 'сценарій' | 'монтаж' | 'опубліковано'
  ctr?: string
  utrymannia?: string
  perehliady?: string
}

export type Kanaly = { kanaly: string[]; video: Video[]; dostupno: boolean }

export type Rezhym = 'nauka' | 'youtube'

export type Potochne = { kanal?: string; video?: string; etap?: string }

declare module 'claude-code' {
  interface PluginState {
    'elena-workspace': {
      robota: Shaped<Robota | null>
      kb: boolean | null
      kanaly: Shaped<Kanaly | null>
      rezhym: Rezhym
      potochne: Shaped<Potochne>
    }
  }
}
