import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SalesOfferingConfig } from '#/db/schema'
import { transcriptionTerms } from './offering'

const offering = {
  projectName: 'Vinhomes Ocean Park 1 - The Paris',
  developer: 'Vinhomes (liên doanh với Mitsubishi Corporation)',
  location: { district: 'Gia Lâm', city: 'Hà Nội' },
} as SalesOfferingConfig

test('transcription terms cover the full project name, its parts, the developer and the district', () => {
  assert.deepEqual(transcriptionTerms(offering), [
    'Vinhomes Ocean Park 1 - The Paris',
    'Vinhomes Ocean Park 1',
    'The Paris',
    'Vinhomes',
    'Gia Lâm',
  ])
})

test('transcription terms skip a missing developer and keep hyphenated names whole', () => {
  assert.deepEqual(
    transcriptionTerms({
      ...offering,
      projectName: 'Lumière Essence Peak',
      developer: undefined,
      location: { district: 'Thủ Đức', city: 'TP.HCM' },
    }),
    ['Lumière Essence Peak', 'Thủ Đức'],
  )
  assert.deepEqual(
    transcriptionTerms({ ...offering, projectName: 'Sky-Garden' }).slice(0, 1),
    ['Sky-Garden'],
  )
})
