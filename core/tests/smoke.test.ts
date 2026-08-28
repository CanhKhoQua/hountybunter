import { describe, expect, it } from 'vitest'
import { VERSION } from '../src/types.js'

describe('scaffold', () => {
  it('exposes a version constant', () => {
    expect(VERSION).toBe('0.0.0')
  })
})
