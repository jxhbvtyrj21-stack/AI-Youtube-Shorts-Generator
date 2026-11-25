import { expect, test } from 'claude-code/testing'

import { FIXTURES } from './fixtures'
import { OPTIONS, kmd, ostannii, stend } from './kit'

const START = { cwd: '/t', surface: 'desktop', isInteractive: true } as const

// ---------- А1. Перед видачею файлу ----------

test('А1 ловить: брудний .docx і немає запису про вичитування', { options: OPTIONS }, async ($, on) => {
  stend(on, FIXTURES)
  await $.session.start(START)
  const r = await $.tool.call({ tool: 'SendUserFile', files: ['/t/robota/robota_pohana.docx'], status: 'normal' })
  expect(r.deny).toBeDefined()
  const text = r.deny ?? ''
  for (const part of ['запису про фінальне вичитування', 'серединна крапка', '«,0»', 'літера «ы»', '[уточнити]', 'крапка з комою']) {
    expect(text).toContain(part)
  }
  expect(text).toContain('robota_pohana.docx')
})

test('А1 ловить: чистий .docx, але в stan.md немає запису про вичитування', { options: OPTIONS }, async ($, on) => {
  stend(on, FIXTURES)
  await $.session.start(START)
  const r = await $.tool.call({ tool: 'SendUserFile', files: ['/t/robota/robota_chysta.docx'], status: 'normal' })
  expect(r.deny).toContain('немає запису про фінальне вичитування')
})

test('А1 ловить: копіювання брудного .docx оболонкою', { options: OPTIONS }, async ($, on) => {
  stend(on, FIXTURES)
  await $.session.start(START)
  const r = await $.tool.call({ tool: 'Bash', command: 'cp "/t/robota/robota_pohana.docx" /t/vydacha/' })
  expect(r.deny).toContain('Перед видачею файлу')
})

test('А1 пропускає: чистий .docx із записом про вичитування', { options: OPTIONS }, async ($, on) => {
  const s = stend(on, FIXTURES)
  await $.session.start(START)
  const r = await $.tool.call({ tool: 'SendUserFile', files: ['/t/robota_vychytana/robota_chysta.docx'], status: 'normal' })
  expect(r.deny).toBeUndefined()
  expect(s.zapysy.notify.some(n => n.startsWith('Файл готовий до видачі'))).toBe(true)
})

test('А1 збій мода: дію пропущено, збій записано в журнал', { options: OPTIONS }, async ($, on) => {
  stend(on, FIXTURES, { failStat: true })
  await $.session.start(START)
  const r = await $.tool.call({ tool: 'SendUserFile', files: ['/t/robota/robota_pohana.docx'], status: 'normal' })
  expect(r.deny).toBeUndefined()
  const zhurnal = await $.command.run(kmd('журнал-моду'))
  expect(zhurnal.text).toContain('перед видачею файлу')
})

// ---------- А2. Захист бази знань ----------

const NOVA = '---\ntitle: Нова\ncreated_by: Claude\nverification: не перевірено\n---\nТекст.\n'

test('А2 пропускає: нова нотатка в 00_Вхідні з потрібним YAML', { options: OPTIONS }, async ($, on) => {
  stend(on, FIXTURES)
  await $.session.start(START)
  const r = await $.tool.call({ tool: 'Write', file_path: '/t/skhovyshche/00_Вхідні/Петренко 2019 — Тривожність.md', content: NOVA })
  expect(r.deny).toBeUndefined()
  const r2 = await $.tool.call({ tool: 'Write', file_path: '/t/skhovyshche/50_Проєкти/2026 Стаття — Тривожність/Проєкт.md', content: NOVA })
  expect(r2.deny).toBeUndefined()
})

test('А2 ловить: перезапис, редагування, чужа папка, YAML, .obsidian, видалення', { options: OPTIONS }, async ($, on) => {
  stend(on, FIXTURES)
  await $.session.start(START)
  const isnuiucha = await $.tool.call({ tool: 'Write', file_path: '/t/skhovyshche/10_Джерела/Іваненко 2020 — Тривожність.md', content: NOVA })
  expect(isnuiucha.deny).toContain('нотатка вже існує')
  const redahuvannia = await $.tool.call({ tool: 'Edit', file_path: '/t/skhovyshche/10_Джерела/Іваненко 2020 — Тривожність.md', old_string: 'Текст', new_string: 'Інше' })
  expect(redahuvannia.deny).toContain('редагувати наявні нотатки заборонено')
  const papka = await $.tool.call({ tool: 'Write', file_path: '/t/skhovyshche/10_Джерела/Нове.md', content: NOVA })
  expect(papka.deny).toContain('лише в 00_Вхідні, 50_Проєкти і 70_YouTube')
  const yaml = await $.tool.call({ tool: 'Write', file_path: '/t/skhovyshche/00_Вхідні/Без полів.md', content: '---\ntitle: Х\n---\n' })
  expect(yaml.deny).toContain('created_by: Claude')
  const obsidian = await $.tool.call({ tool: 'Write', file_path: '/t/skhovyshche/.obsidian/app.json', content: '{}' })
  expect(obsidian.deny).toContain('.obsidian')
  const rm = await $.tool.call({ tool: 'Bash', command: 'rm "/t/skhovyshche/10_Джерела/Іваненко 2020 — Тривожність.md"' })
  expect(rm.deny).toContain('видаляти, переміщувати чи перейменовувати')
  const mv = await $.tool.call({ tool: 'Bash', command: 'mv /t/skhovyshche/00_Вхідні/a.md /t/skhovyshche/10_Джерела/a.md' })
  expect(mv.deny).toBeDefined()
})

test('А2 пропускає: запис поза сховищем і читання сховища', { options: OPTIONS }, async ($, on) => {
  stend(on, FIXTURES)
  await $.session.start(START)
  expect((await $.tool.call({ tool: 'Write', file_path: '/t/robota/notatky.md', content: 'x' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Bash', command: 'grep -r "тривож" /t/skhovyshche/10_Джерела' })).deny).toBeUndefined()
})

// ---------- А3. Фільтр джерел ----------

test('А3 ловить: рядок з російським джерелом у dzherela.tsv', { options: OPTIONS }, async ($, on) => {
  stend(on, FIXTURES)
  await $.session.start(START)
  const tsv = '№\tопис\tрік\n1\tПетренко О.\t2019\thttps://doi.org/10.1/x\n2\tИванов И.\t2020\thttps://cyberleninka.ru/article/n/1\n'
  const r = await $.tool.call({ tool: 'Write', file_path: '/t/robota/dzherela.tsv', content: tsv })
  expect(r.deny).toContain('рядок 3')
  expect(r.deny).toContain('cyberleninka.ru')
  const edit = await $.tool.call({ tool: 'Edit', file_path: '/t/robota/dzherela.tsv', old_string: '5\tБойко Н. Адаптація\t2020\tук', new_string: '5\tБойко Н. Адаптація\t2020\tук\thttps://elib.bsu.by/handle/1' })
  expect(edit.deny).toContain('домен elib.bsu.by')
})

test('А3 попереджає без блокування: веб-запит до .ru, і пропускає чисте', { options: OPTIONS }, async ($, on) => {
  const s = stend(on, FIXTURES)
  await $.session.start(START)
  const ru = await $.tool.call({ tool: 'WebFetch', url: 'https://elibrary.ru/item.asp?id=1', prompt: 'x' })
  expect(ru.deny).toBeUndefined()
  expect((ru.context ?? []).join(' ')).toContain('домен elibrary.ru')
  expect(s.zapysy.toast.some(t => t.startsWith('Фільтр джерел'))).toBe(true)
  const ok = await $.tool.call({ tool: 'WebFetch', url: 'https://doi.org/10.1000/1', prompt: 'x' })
  expect(ok.context ?? []).toHaveLength(0)
  const tsv = '№\tопис\tрік\n1\tПетренко О.\t2019\thttps://doi.org/10.1/x\n'
  expect((await $.tool.call({ tool: 'Write', file_path: '/t/robota/dzherela.tsv', content: tsv })).deny).toBeUndefined()
})

// ---------- А4. Рядок стану ----------

test('А4 показує дані роботи і доступність бази знань', { options: OPTIONS }, async ($, on) => {
  const s = stend(on, FIXTURES)
  await $.session.start(START)
  const status = ostannii(s.zapysy.status) ?? ''
  expect(status).toBe('Тривожність студентів під час дистанцій… | етап 3 | КТ3 | рецензія: раунд 2 | Wiley: 12 | база знань: доступна')
})

test('А4 без робочої теки і без сховища: «роботу не знайдено», «недоступна»', { options: { ...OPTIONS, vault_path: '/t/nemaie' } }, async ($, on) => {
  const s = stend(on, FIXTURES, { root: '/t/bez_roboty', store: {} })
  await $.session.start({ ...START, cwd: '/t/bez_roboty' })
  expect(ostannii(s.zapysy.status)).toBe('Наука | роботу не знайдено | база знань: недоступна')
})

// ---------- А5. Панель «Хід роботи» ----------

const PANE = {
  plugin: 'elena-workspace',
  component: 'Pane',
  requestId: 'elena-khid-roboty',
  props: { title: 'Хід роботи', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('А5 панель показує КТ, наряд, зауваження, джерела і заглушки на кожній поверхні', { options: OPTIONS }, async ($, on) => {
  stend(on, FIXTURES)
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /✓ КТ0  ✓ КТ1  ✓ КТ2  ▶ КТ3/ }))).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^З-02 .* — у роботі$/ }))).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^Б: 1   С: 1   Д: 2$/ }))).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^Джерел: 5, з них 2018 р\. і пізніше: 80 %$/ }))).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^Заглушок «\[уточнити\]»: 2$/ }))).toBeDefined()
    await ui.unmount()
  }
})

test('А5 оновлюється сама після зміни stan.md', { options: OPTIONS }, async ($, on) => {
  const s = stend(on, FIXTURES)
  await $.session.start(START)
  s.set('/t/robota/stan.md', `${s.files.get('/t/robota/stan.md')?.text ?? ''}КТ3 закрито: рукопис прийнято\nScholar Gateway (Wiley): залишок 3\n`)
  await $.tool.call({ tool: 'Write', file_path: '/t/robota/stan.md', content: 'x' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /✓ КТ3/ }))).toBeDefined()
  await ui.unmount()
})

test('А5 без робочої теки: повідомлення замість даних', { options: OPTIONS }, async ($, on) => {
  stend(on, FIXTURES, { root: '/t/bez_roboty', store: {} })
  await $.session.start({ ...START, cwd: '/t/bez_roboty' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Робочу теку.* не знайдено/ }))).toBeDefined()
  await ui.unmount()
})

// ---------- А6. Slash-команди ----------

test('А6 команди: markdown-промпт з даними мода, /стан відповідає сам', { options: OPTIONS }, async ($, on) => {
  stend(on, FIXTURES)
  await $.session.start(START)
  const nova = await $.command.run(kmd('нова-робота', 'Тривожність підлітків'))
  expect(nova.text).toBe('markdown:нова-робота')
  expect((nova.context ?? []).join(' ')).toContain('прочитай CLAUDE.md')
  const zriz = await $.command.run(kmd('стан'))
  expect(zriz.text).toContain('Поточна точка: КТ3')
  expect(zriz.text).toContain('Ліміт Wiley: 12')
  const vych = await $.command.run(kmd('вичитати', '/t/robota/robota_pohana.docx'))
  expect(vych.text).toBe('markdown:вичитати')
  expect((vych.context ?? []).join(' ')).toContain('серединна крапка')
})

test('А6 вимкнений модуль команд нічого не запускає', { options: { ...OPTIONS, nauka_komandy: false } }, async ($, on) => {
  stend(on, FIXTURES)
  await $.session.start(START)
  const r = await $.command.run(kmd('нова-робота', 'Тема'))
  expect(r.text).toContain('вимкнено')
})

// ---------- А7. Сповіщення ----------

test('А7 ловить: закрито КТ, ліміт Wiley менше 5, база знань недоступна', { options: OPTIONS }, async ($, on) => {
  const s = stend(on, FIXTURES)
  await $.session.start(START)
  expect(s.zapysy.notify).toHaveLength(0)
  s.set('/t/robota/stan.md', `${s.files.get('/t/robota/stan.md')?.text ?? ''}КТ3 закрито: рукопис прийнято\nScholar Gateway (Wiley): залишок 3\n`)
  await $.tool.call({ tool: 'Write', file_path: '/t/robota/stan.md', content: 'x' })
  expect(s.zapysy.notify).toContain('Закрито контрольну точку КТ3')
  expect(s.zapysy.notify).toContain('Ліміт Wiley: лишилося 3 запити')
  s.remove('/t/skhovyshche')
  await $.tool.call({ tool: 'Write', file_path: '/t/robota/stan.md', content: 'x' })
  expect(s.zapysy.notify).toContain('База знань недоступна')
})

test('А7 пропускає: без змін сповіщень немає', { options: OPTIONS }, async ($, on) => {
  const s = stend(on, FIXTURES)
  await $.session.start(START)
  await $.tool.call({ tool: 'Write', file_path: '/t/robota/stan.md', content: 'x' })
  expect(s.zapysy.notify).toHaveLength(0)
})

// ---------- Налаштування модулів ----------

test('А1 заглушка «[уточнити]» за замовчуванням лише попереджає', { options: OPTIONS }, async ($, on) => {
  stend(on, FIXTURES)
  await $.session.start(START)
  const r = await $.tool.call({ tool: 'SendUserFile', files: ['/t/robota_vychytana/z_zaglushkoiu.docx'], status: 'normal' })
  expect(r.deny).toBeUndefined()
  expect((r.context ?? []).join(' ')).toContain('заглушка «[уточнити]»')
})

test('А1 з увімкненим блокуванням заглушок файл не видається', { options: { ...OPTIONS, nauka_zaglushky_blok: true } }, async ($, on) => {
  stend(on, FIXTURES)
  await $.session.start(START)
  const r = await $.tool.call({ tool: 'SendUserFile', files: ['/t/robota_vychytana/z_zaglushkoiu.docx'], status: 'normal' })
  expect(r.deny).toContain('заглушка «[уточнити]»')
})

test('Вимкнений «Захист бази знань» нічого не блокує', { options: { ...OPTIONS, nauka_kb: false } }, async ($, on) => {
  stend(on, FIXTURES)
  await $.session.start(START)
  const r = await $.tool.call({ tool: 'Edit', file_path: '/t/skhovyshche/10_Джерела/Іваненко 2020 — Тривожність.md', old_string: 'Текст', new_string: 'Інше' })
  expect(r.deny).toBeUndefined()
})

// ---------- А2. Виняток: нотатки проєктів, створені Claude ----------

const PROIEKT_CLAUDE = '/t/skhovyshche/50_Проєкти/2026 Стаття — Тривожність/Проєкт.md'
const PROIEKT_OLENY = '/t/skhovyshche/50_Проєкти/2025 Курсова — Мотивація/Проєкт.md'

test('А2 пропускає: зміна нотатки в 50_Проєкти з created_by: Claude', { options: OPTIONS }, async ($, on) => {
  stend(on, FIXTURES)
  await $.session.start(START)
  const edit = await $.tool.call({ tool: 'Edit', file_path: PROIEKT_CLAUDE, old_string: 'Розділ 1.', new_string: 'Розділ 1. Розділ 2.' })
  expect(edit.deny).toBeUndefined()
  const write = await $.tool.call({ tool: 'Write', file_path: PROIEKT_CLAUDE, content: '---\ntitle: Тривожність студентів\ncreated_by: Claude\nverification: не перевірено\n---\n## Структура\nОновлено.\n' })
  expect(write.deny).toBeUndefined()
})

test('А2 ловить: проєкт користувачки, зміна created_by чи verification, нотатка Claude поза 50_Проєкти', { options: OPTIONS }, async ($, on) => {
  stend(on, FIXTURES)
  await $.session.start(START)
  const oleny = await $.tool.call({ tool: 'Edit', file_path: PROIEKT_OLENY, old_string: 'Розділ 1.', new_string: 'Розділ 2.' })
  expect(oleny.deny).toContain('редагувати наявні нотатки заборонено')
  const avtor = await $.tool.call({ tool: 'Edit', file_path: PROIEKT_CLAUDE, old_string: 'created_by: Claude', new_string: 'created_by: Олена' })
  expect(avtor.deny).toContain('має лишитися created_by: Claude')
  const perevirka = await $.tool.call({ tool: 'Edit', file_path: PROIEKT_CLAUDE, old_string: 'verification: не перевірено', new_string: 'verification: перевірено користувачкою' })
  expect(perevirka.deny).toContain('verification змінює лише користувачка')
  const youtube = await $.tool.call({ tool: 'Edit', file_path: '/t/skhovyshche/70_YouTube/Відео/Як читати статті.md', old_string: 'status: ідея', new_string: 'status: сценарій' })
  expect(youtube.deny).toContain('редагувати наявні нотатки заборонено')
  const rm = await $.tool.call({ tool: 'Bash', command: `rm "${PROIEKT_CLAUDE}"` })
  expect(rm.deny).toContain('видаляти, переміщувати чи перейменовувати')
})
