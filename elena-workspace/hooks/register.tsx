import { atom, read } from 'claude-code'
import type { Register } from 'claude-code'

import { basename, dirname, frontmatter, vidnosnoSkhovyshcha } from './lib/perevirky'
import { NAUKA_KOMANDY, komandaNauky, ocinkaDzherel, ocinkaKB, ocinkaVydachi, panelHooks as naukaPanel } from './nauka'
import type { $, Cfg, Rishennia } from './spilne'
import {
  PANEL_NAUKA, PANEL_YOUTUBE, RABOCHI, onovytyKB, onovytyKanaly, onovytyRobotu, onovytyStatus, pamiatatyTeku, vstanovytyPotochne, vstanovytyRezhym, zKontekstom, zbii,
} from './spilne'
import { banerHooks, startTemy, temyHooks } from './vyhliad'
import { YOUTUBE_KOMANDY, komandaYoutube, ocinkaVyklykuYoutube, panelHooks as ytPanel, zakhystHooks } from './youtube'

const rezhymA = atom({ plugin: 'elena-workspace', key: 'rezhym' } as const, 'nauka')

const bool = (v: unknown, d = true) => (typeof v === 'boolean' ? v : d)
const text = (v: unknown, d: string) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : d)

async function obnova($: $, cfg: Cfg, iz: { kanaly?: boolean }) {
  await onovytyKB($, cfg)
  await onovytyRobotu($, cfg)
  if (cfg.youtube.panel && iz.kanaly === true) await onovytyKanaly($, cfg)
  await onovytyStatus($, cfg)
}

const VYMKNENO = { text: 'Цей модуль вимкнено в налаштуваннях elena-workspace.', isTextDisplayOnly: true as const }

async function zminaRezhymu($: $, cfg: Cfg, args: string) {
  const a = args.trim().toLowerCase()
  const zaraz = await read($, rezhymA)
  const novyi = a.startsWith('н') ? 'nauka' : a.startsWith('y') || a.startsWith('ю') ? 'youtube' : zaraz === 'nauka' ? 'youtube' : 'nauka'
  await vstanovytyRezhym($, novyi)
  await onovytyStatus($, cfg)
  if (novyi === 'nauka' && cfg.nauka.panel) void $.ui.open({ id: PANEL_NAUKA, title: 'Хід роботи' })
  if (novyi === 'youtube' && cfg.youtube.panel) void $.ui.open({ id: PANEL_YOUTUBE, title: 'Канали' })
  return { text: `Режим: ${novyi === 'nauka' ? 'Наука' : 'YouTube'}.`, isTextDisplayOnly: true as const }
}

async function zhurnal($: $) {
  const list = ((await $.store.get('zhurnal')) as { chas: string; de: string; pomylka: string }[] | undefined) ?? []
  const tail = list.slice(-20).map(z => `${z.chas} ${z.de}: ${z.pomylka}`)
  return { text: tail.length === 0 ? 'Збоїв не записано.' : tail.join('\n'), isTextDisplayOnly: true as const }
}

export const register: Register = (on, options) => {
  const cfg: Cfg = {
    vault: text(options['vault_path'], 'G:\\Мій диск\\MY_KNOWLEDGE_SYSTEM\\01_OBSIDIAN\\Knowledge_Base\\Knowledge_Base'),
    kanaly: text(options['kanaly'], '').split(/[,;]/).map(s => s.trim()).filter(s => s !== ''),
    nauka: {
      vydacha: bool(options['nauka_vydacha']),
      zaglushkyBlok: bool(options['nauka_zaglushky_blok'], false),
      kb: bool(options['nauka_kb']),
      dzherela: bool(options['nauka_dzherela']),
      panel: bool(options['nauka_panel']),
      komandy: bool(options['nauka_komandy']),
    },
    youtube: {
      komandy: bool(options['youtube_komandy']),
      panel: bool(options['youtube_panel']),
      zakhyst: bool(options['youtube_zakhyst']),
    },
    vyhliad: { temy: bool(options['vyhliad_temy']), baner: bool(options['vyhliad_baner']) },
  }
  const poias = text(options['chasovyi_poias'], 'Europe/Kyiv')

  if (cfg.nauka.panel) naukaPanel(on, cfg)
  if (cfg.youtube.panel) ytPanel(on, cfg)
  if (cfg.youtube.zakhyst) zakhystHooks(on, cfg)
  if (cfg.vyhliad.temy) temyHooks(cfg, poias)
  if (cfg.vyhliad.baner) banerHooks(on, cfg, poias)

  on('session.start', async ($, e, next) => {
    try {
      if (cfg.vyhliad.temy) await startTemy($, poias).catch(err => zbii($, 'тема', err))
      await obnova($, cfg, { kanaly: true })
      let tick = 0
      $.clock.every(60_000, () => {
        tick++
        return obnova($, cfg, { kanaly: tick % 5 === 0 }).catch(err => zbii($, 'оновлення', err))
      })
      const rezhym = await read($, rezhymA)
      if (rezhym === 'nauka' && cfg.nauka.panel) void $.ui.open({ id: PANEL_NAUKA, title: 'Хід роботи' })
      if (rezhym === 'youtube' && cfg.youtube.panel) void $.ui.open({ id: PANEL_YOUTUBE, title: 'Канали' })
    } catch (err) {
      await zbii($, 'запуск', err)
    }
    return next(e)
  })

  // Команди живуть у commands/*.md; мод перехоплює їх і виконує розширену логіку.
  on('command.run', async ($, e, next) => {
    const name = e.command.replace(/^elena-workspace:/, '')
    try {
      let kontekst: string | undefined
      if (NAUKA_KOMANDY.includes(name)) {
        if (!cfg.nauka.komandy) return VYMKNENO
        const k = await komandaNauky($, cfg, name, e.args)
        if (k.vidpovid !== undefined) return k.vidpovid
        kontekst = k.kontekst
      } else if (YOUTUBE_KOMANDY.includes(name)) {
        if (!cfg.youtube.komandy) return VYMKNENO
        kontekst = (await komandaYoutube($, cfg, name, e.args)).kontekst
      }
      if (kontekst !== undefined) {
        const r = await next(e)
        return { ...r, context: [...(r.context ?? []), kontekst] }
      }
      if (name === 'режим') return await zminaRezhymu($, cfg, e.args)
      if (name === 'журнал-моду') return await zhurnal($)
    } catch (err) {
      await zbii($, `команда /${name}`, err)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Один диспетчер для всіх запобіжників: блокує лише безсумнівне, збій мода пропускає дію.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const perevirky: [boolean, string, () => Promise<Rishennia>][] = [
      [cfg.nauka.vydacha, 'перед видачею файлу', () => ocinkaVydachi($, cfg, tool, input)],
      [cfg.nauka.kb, 'захист бази знань', () => ocinkaKB($, cfg, tool, input)],
      [cfg.nauka.dzherela, 'фільтр джерел', () => ocinkaDzherel($, tool, input)],
      [cfg.youtube.zakhyst, 'захист YouTube', () => ocinkaVyklykuYoutube($, cfg, input)],
    ]
    const warns: string[] = []
    for (const [uvimkneno, de, f] of perevirky) {
      if (!uvimkneno) continue
      try {
        const d = await f()
        if (d.deny !== undefined) return { deny: d.deny }
        if (d.warn !== undefined) warns.push(d.warn)
      } catch (err) {
        await zbii($, de, err)
      }
    }
    for (const w of warns) $.ui.toast(w.split('\n')[0] ?? w)
    const r = await next(e)
    try {
      const path = typeof input['file_path'] === 'string' ? input['file_path'] : undefined
      const cmd = typeof input['command'] === 'string' ? input['command'] : ''
      const rel = path === undefined ? undefined : vidnosnoSkhovyshcha(path, cfg.vault)
      if (path !== undefined && RABOCHI.test(path)) {
        await pamiatatyTeku($, dirname(path))
        await vstanovytyRezhym($, 'nauka')
        await obnova($, cfg, {})
      } else if (rel !== undefined && /^70_YouTube\//i.test(rel)) {
        await vstanovytyRezhym($, 'youtube')
        const content = typeof input['content'] === 'string' ? input['content'] : ''
        const fm = frontmatter(content)
        if (fm !== undefined && r.deny === undefined) {
          const p: { kanal?: string; video?: string; etap?: string } = { video: fm['title'] ?? basename(rel).replace(/\.md$/i, '') }
          const kanal = fm['channel'] ?? fm['kanal']
          const etap = fm['status'] ?? fm['stage']
          if (kanal !== undefined && kanal !== '') p.kanal = kanal
          if (etap !== undefined && etap !== '') p.etap = etap
          await vstanovytyPotochne($, p)
        }
        await obnova($, cfg, { kanaly: true })
      } else if (/stan\.md|naryad\.md|retsenziia_\d+\.md|dzherela\.tsv/i.test(cmd)) {
        await obnova($, cfg, {})
      }
    } catch (err) {
      await zbii($, 'оновлення після інструмента', err)
    }
    return zKontekstom(r, warns.length === 0 ? undefined : warns.join('\n'))
  }).catch(($, e, next) => next(e))
}
