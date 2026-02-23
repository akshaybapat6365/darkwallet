import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const contractPath = path.resolve(process.cwd(), 'midnight/contract/src/pickup.compact')
const source = fs.readFileSync(contractPath, 'utf8')

describe('pickup.compact security invariants', () => {
  it('keeps public ledger state commitment-only', () => {
    expect(source).toMatch(/export ledger authorizations: Set<Bytes<32>>;/)
    expect(source).toMatch(/export ledger spent: Set<Bytes<32>>;/)
    expect(source).not.toMatch(/export ledger .*patientSecretKey/i)
    expect(source).not.toMatch(/export ledger .*issuerSecretKey/i)
  })

  it('implements nullifier-based replay protection', () => {
    expect(source).toMatch(/redemptionNullifier/)
    expect(source).toMatch(/assert\(!spent\.member\(nul\), "already redeemed"\);/)
    expect(source).toMatch(/spent\.insert\(nul\);/)
  })
})
