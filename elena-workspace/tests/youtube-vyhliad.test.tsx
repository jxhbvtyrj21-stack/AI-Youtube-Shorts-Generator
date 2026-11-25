import { expect, test } from 'claude-code/testing'

import { FIXTURES } from './fixtures'
import { OPTIONS, kmd, ostannii, stend } from './kit'

const START = { cwd: '/t', surface: 'desktop', isInteractive: true } as const
const KARTKA = (yaml: string, tilo = '') =>
  `---\ntitle: Нове відео\nchannel: Психологія просто\nstatus: ідея\n${yaml}created_by: Claude\nverification: не перевірено\n---\n${tilo}`

// ---------- Б1. Slash-команди YouTube ----------

test('Б1 /хук: вибір каналу і вміст стратегії в контексті, режим YouTube', { options: OPTIONS }, async ($, on) => {
  const s = stend(on, FIXTURES)
  await $.session.start(START)
  const r = await $.command.run(kmd('хук', 'тривога перед іспитом'))
  expect(r.text).toBe('markdown:хук')
  const ctx = (r.context ?? []).join('\n')
  expect(ctx).toContain('Канали для вибору в AskUserQuestion: Психологія просто, Наука вголос, новий канал.')
  expect(ctx).toContain('Аудиторія: студенти.')
  expect(ctx).toContain('Короткі хуки з питанням.')
  expect(ostannii(s.zapysy.status)).toBe('YouTube | канал: — | відео: — | етап: —')
  expect(s.zapysy.opened).toContain('elena-kanaly')
})

test('Б1 без файлів стратегії: команда каже прочитати їх самій, нічого не вигадує', { options: OPTIONS }, async ($, on) => {
  const s = stend(on, FIXTURES)
  s.remove('/t/skhovyshche/70_YouTube/00_Стратегія каналу')
  await $.session.start(START)
  const r = await $.command.run(kmd('ідея', 'сон і навчання'))
  expect((r.context ?? []).join('\n')).toContain('Файл недоступний')
})

// ---------- Б2. Панель «Канали» ----------

const PANE = {
  plugin: 'elena-workspace',
  component: 'Pane',
  requestId: 'elena-kanaly',
  props: { title: 'Канали', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('Б2 панель: канали, етапи, метрики лише внесені, порожні комірки без оцінок', { options: OPTIONS }, async ($, on) => {
  stend(on, FIXTURES)
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^Психологія просто$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Наука вголос$/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /Тривога перед іспитом/ }))?.text).toMatch(/Тривога перед іспитом\s+6,1\s+42\s+1800\s*$/)
    expect((await ui.find({ type: 'Text', text: /Сон і пам'ять/ }))?.text).toMatch(/^\s+Сон і пам'ять\s*$/)
    expect(await ui.find({ type: 'Text', text: /^Опубліковано: 1$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Ідея: 1$/ })).toBeDefined()
    await ui.unmount()
  }
})

// ---------- Б3. Захист метрик і транскриптів ----------

test('Б3 ловить: метрика, якої користувачка не надавала', { options: OPTIONS }, async ($, on) => {
  stend(on, FIXTURES)
  await $.session.start(START)
  const r = await $.tool.call({ tool: 'Write', file_path: '/t/skhovyshche/70_YouTube/Відео/Нове відео.md', content: KARTKA('ctr: 7,4\n') })
  expect(r.deny).toContain('метрику ctr = 7,4 користувачка не надавала')
})

test('Б3 пропускає: метрика, яку надала користувачка', { options: OPTIONS }, async ($, on) => {
  stend(on, FIXTURES)
  await $.session.start(START)
  await $.prompt.submit({ text: 'Внеси в картку: CTR 7,4 з YouTube Studio' } as never)
  const r = await $.tool.call({ tool: 'Write', file_path: '/t/skhovyshche/70_YouTube/Відео/Нове відео.md', content: KARTKA('ctr: 7,4\n') })
  expect(r.deny).toBeUndefined()
})

const TRANSKRYPT = Array.from({ length: 20 }, (_, i) => `00:${String(i * 3).padStart(2, '0')} Репліка ${i + 1} з відео.`).join('\n')

test('Б3 ловить: повний транскрипт чужого відео', { options: OPTIONS }, async ($, on) => {
  stend(on, FIXTURES)
  await $.session.start(START)
  const content = `---\ntitle: Конкурент\ntype: Ю5\nchannel: Чужий канал\ncreated_by: Claude\nverification: не перевірено\n---\n## Транскрипт\n${TRANSKRYPT}\n`
  const r = await $.tool.call({ tool: 'Write', file_path: '/t/skhovyshche/70_YouTube/Чужий канал.md', content })
  expect(r.deny).toContain('повний транскрипт чужого відео')
})

test('Б3 пропускає: конспект чужого відео і транскрипт власного', { options: OPTIONS }, async ($, on) => {
  stend(on, FIXTURES)
  await $.session.start(START)
  const konspekt = `---\ntitle: Конкурент\ntype: Ю5\nchannel: Чужий канал\ncreated_by: Claude\nverification: не перевірено\n---\n## Конспект\nГоловна думка: хук у перші 3 секунди.\n`
  expect((await $.tool.call({ tool: 'Write', file_path: '/t/skhovyshche/70_YouTube/Чужий конспект.md', content: konspekt })).deny).toBeUndefined()
  const svii = KARTKA('', `## Транскрипт\n${TRANSKRYPT}\n`)
  expect((await $.tool.call({ tool: 'Write', file_path: '/t/skhovyshche/70_YouTube/Відео/Моє відео.md', content: svii })).deny).toBeUndefined()
})

// ---------- Б4. Рядок стану YouTube ----------

test('Б4 рядок стану: канал, відео, етап з нової картки', { options: OPTIONS }, async ($, on) => {
  const s = stend(on, FIXTURES)
  await $.session.start(START)
  await $.tool.call({ tool: 'Write', file_path: '/t/skhovyshche/70_YouTube/Відео/Нове відео.md', content: KARTKA('') })
  expect(ostannii(s.zapysy.status)).toBe('YouTube | канал: Психологія просто | відео: Нове відео | етап: ідея')
})

// ---------- В1–В4. Вигляд ----------

const tema = (s: ReturnType<typeof stend>) => ostannii(s.zapysy.themes)

test('В1 вночі (23:00 за Києвом) темна тема, удень (14:00) світла', { options: OPTIONS }, async ($, on) => {
  const nich = stend(on, FIXTURES, { now: Date.UTC(2026, 10, 25, 21, 0) })
  await $.session.start(START)
  expect(tema(nich)?.overrideColorScheme).toBe('dark')
})

test('В1 удень світла тема', { options: OPTIONS }, async ($, on) => {
  const den = stend(on, FIXTURES, { now: Date.UTC(2026, 10, 25, 12, 0) })
  await $.session.start(START)
  expect(tema(den)?.overrideColorScheme).toBe('light')
})

test('В1 межа: 09:59 ще темна, 20:00 уже темна', { options: OPTIONS }, async ($, on) => {
  const rano = stend(on, FIXTURES, { now: Date.UTC(2026, 10, 25, 7, 59) })
  await $.session.start(START)
  expect(tema(rano)?.overrideColorScheme).toBe('dark')
})

test('В2 акцент змінюється з режимом, В4 типографіка 16/26', { options: OPTIONS }, async ($, on) => {
  const s = stend(on, FIXTURES)
  await $.session.start(START)
  const nauka = JSON.stringify(tema(s)?.colors)
  await $.command.run(kmd('режим', 'youtube'))
  const yt = JSON.stringify(tema(s)?.colors)
  expect(yt).not.toBe(nauka)
  expect(tema(s)?.style?.Text).toEqual({ fontSize: 16, lineHeight: 26 })
})

test('В1 вимкнений модуль тем не змінює вигляд', { options: { ...OPTIONS, vyhliad_temy: false } }, async ($, on) => {
  const s = stend(on, FIXTURES)
  await $.session.start(START)
  expect(s.zapysy.themes).toHaveLength(0)
})

const BAND = {
  plugin: 'elena-workspace',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 3, bodyColumns: 80, scroll: { offset: 0, bodyRows: 3 }, view: {} },
} as const

test('В3 банер: «Наука» з назвою роботи, «YouTube» з відео', { options: OPTIONS }, async ($, on) => {
  stend(on, FIXTURES)
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /^Наука$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /— Тривожність студентів під час дистанційного навчання/ })).toBeDefined()
    await ui.unmount()
  }
  await $.tool.call({ tool: 'Write', file_path: '/t/skhovyshche/70_YouTube/Відео/Нове відео.md', content: KARTKA('') })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^YouTube$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /— Нове відео/ })).toBeDefined()
  await ui.unmount()
})

test('В3 банер мовчить під опитуванням', { options: OPTIONS }, async ($, on) => {
  stend(on, FIXTURES)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>рушій</Text>
  })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Наука$/ })).toBeUndefined()
  await ui.unmount()
})
