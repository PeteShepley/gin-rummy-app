import { expect, test } from 'vitest'

// Tooling smoke test; the phase-1 engine tests supersede it.
test('the test toolchain runs', () => {
  expect(2 + 2).toBe(4)
})
