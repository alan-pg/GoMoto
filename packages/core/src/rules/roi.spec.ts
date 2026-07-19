import { describe, it, expect } from 'vitest'
import { calculateVehicleROI } from './roi'

const baseCosts = { maintenance: 0, insurance: 0, documentation: 0, other: 0 }

describe('calculateVehicleROI', () => {
  // CA-050: aquisição R$8k, receitas R$12k, custos R$3k, sem venda
  it('CA-050: ROI sem alienação', () => {
    const costs = { ...baseCosts, maintenance: 2000, insurance: 1000 }
    const r = calculateVehicleROI(8000, 12000, costs)
    // net = 12000 + 0 - 8000 - 3000 = 1000; roi = 1000/8000*100 = 12.5
    expect(r.net_result).toBe(1000)
    expect(r.roi).toBe(12.5)
    expect(r.total_costs).toBe(3000)
  })

  // CA-051: mesmo veículo alienado por R$5k
  it('CA-051: ROI com alienação', () => {
    const costs = { ...baseCosts, maintenance: 2000, insurance: 1000 }
    const r = calculateVehicleROI(8000, 12000, costs, 5000)
    // net = 12000 + 5000 - 8000 - 3000 = 6000; roi = 6000/8000*100 = 75
    expect(r.net_result).toBe(6000)
    expect(r.roi).toBe(75)
  })

  // CA-052: sem valor de aquisição → roi=null
  it('CA-052: acquisition_value null → roi e net_result null', () => {
    const r = calculateVehicleROI(null, 12000, baseCosts)
    expect(r.net_result).toBe(null)
    expect(r.roi).toBe(null)
  })

  // RN-044: ROI só calculado quando acquisition_value está registrado
  it('RN-044: acquisition_value=null bloqueia cálculo', () => {
    const r = calculateVehicleROI(null, 5000, { ...baseCosts, maintenance: 1000 })
    expect(r.roi).toBeNull()
    expect(r.net_result).toBeNull()
  })

  // RN-045: veículo não alienado → sem saleValue no cálculo
  it('RN-045: sem saleValue, ROI parcial operacional', () => {
    const r = calculateVehicleROI(10000, 8000, baseCosts)
    expect(r.net_result).toBe(-2000)  // 8000 - 10000
    expect(r.roi).toBe(-20)
  })

  // Total de custos por categoria somados corretamente
  it('total_costs soma todas as categorias', () => {
    const costs = { maintenance: 500, insurance: 300, documentation: 200, other: 100 }
    const r = calculateVehicleROI(5000, 0, costs)
    expect(r.total_costs).toBe(1100)
  })

  // Receitas somadas corretamente (RN-040)
  it('RN-040: receitas entram positivamente no resultado', () => {
    const r = calculateVehicleROI(1000, 1500, baseCosts)
    expect(r.net_result).toBe(500)
    expect(r.roi).toBe(50)
  })
})
