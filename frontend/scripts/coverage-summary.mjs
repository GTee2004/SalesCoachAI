// Prints a Markdown line-coverage summary from `pnpm test:coverage`.
// Node only reports files the tests load, so every other source file is
// counted here with all of its lines uncovered. Usage:
//   node scripts/coverage-summary.mjs [coverage/lcov.info]
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const lcovPath = process.argv[2] ?? 'coverage/lcov.info'

const areas = [
  { name: 'Logic (`src/lib`, `src/db`)', dirs: ['src/lib/', 'src/db/'] },
  {
    name: 'UI (`src/routes`, `src/components`, `src/hooks`)',
    dirs: ['src/routes/', 'src/components/', 'src/hooks/'],
  },
  { name: 'Other (`src/*`, `src/integrations`)', dirs: ['src/'] },
]

const isSource = (path) =>
  /\.tsx?$/.test(path) &&
  !/\.test\.tsx?$/.test(path) &&
  path !== 'src/routeTree.gen.ts'

// Counted the way Node counts lines in the files it reports.
const lineCount = (path) => {
  const text = readFileSync(path, 'utf8')
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

const loaded = new Map()
let file
const totals = { brf: 0, brh: 0, fnf: 0, fnh: 0 }
for (const line of readFileSync(lcovPath, 'utf8').split('\n')) {
  const [key, value] = [
    line.slice(0, line.indexOf(':')),
    line.slice(line.indexOf(':') + 1),
  ]
  if (key === 'SF') {
    file = { path: value, lf: 0, lh: 0 }
    loaded.set(value, file)
  } else if (key === 'LF') file.lf = Number(value)
  else if (key === 'LH') file.lh = Number(value)
  else if (key === 'BRF') totals.brf += Number(value)
  else if (key === 'BRH') totals.brh += Number(value)
  else if (key === 'FNF') totals.fnf += Number(value)
  else if (key === 'FNH') totals.fnh += Number(value)
}

const files = readdirSync('src', { recursive: true })
  .map((path) => join('src', path))
  .filter(isSource)
  .sort()
  .map(
    (path) =>
      loaded.get(path) ?? { path, lf: lineCount(path), lh: 0, untested: true },
  )

const sum = (list) => ({
  files: list.length,
  tested: list.filter((f) => !f.untested).length,
  lf: list.reduce((n, f) => n + f.lf, 0),
  lh: list.reduce((n, f) => n + f.lh, 0),
})
const percent = (hit, found) =>
  found === 0 ? '–' : `${((hit / found) * 100).toFixed(1)}%`
const count = (n) => n.toLocaleString('en-US')
const row = (name, s) =>
  `| ${name} | ${s.tested}/${s.files} | ${percent(s.lh, s.lf)} | ${count(s.lh)}/${count(s.lf)} |`

const remaining = [...files]
const rows = areas.map((area) => {
  const inArea = remaining.filter((f) =>
    area.dirs.some((d) => f.path.startsWith(d)),
  )
  for (const f of inArea) remaining.splice(remaining.indexOf(f), 1)
  return row(area.name, sum(inArea))
})
const all = sum(files)
const tested = sum(files.filter((f) => !f.untested))

console.log(`## Frontend coverage

**${percent(all.lh, all.lf)}** of lines across all ${all.files} source files in \`src/\`. Files no test loads count as 0%; tests and the generated \`routeTree.gen.ts\` are excluded.

| Area | Files with tests | Lines | Covered/total |
|---|---:|---:|---:|
${rows.join('\n')}
${row('**All source**', all)}

In the ${tested.files} files the tests load: ${percent(tested.lh, tested.lf)} of lines, ${percent(totals.brh, totals.brf)} of branches, ${percent(totals.fnh, totals.fnf)} of functions.`)
