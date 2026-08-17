import type { VehicleROI, VehicleCostsByCategory } from '../types/financial'

/**
 * Calcula resultado líquido e ROI de um veículo (RN-040 a RN-045).
 *
 * @param acquisitionValue Valor de aquisição — null gera roi=null (RN-044).
 * @param revenues         Soma de todos os pagamentos recebidos de locações.
 * @param costsByCategory  Custos por categoria (sem acquisition_amount).
 * @param saleValue        Valor de venda se alienado; null = não alienado (RN-045).
 */
export function calculateVehicleROI(
  acquisitionValue: number | null,
  revenues: number,
  costsByCategory: VehicleCostsByCategory,
  saleValue?: number | null,
): Pick<VehicleROI, 'net_result' | 'roi' | 'total_costs'> {
  const totalOperationalCosts = round2(
    costsByCategory.maintenance +
    costsByCategory.insurance +
    costsByCategory.documentation +
    costsByCategory.other,
  )

  if (acquisitionValue === null) {
    return { net_result: null, roi: null, total_costs: totalOperationalCosts }
  }

  // Resultado líquido = receitas + venda (se houver) − aquisição − custos operacionais (RN-042)
  const net_result = round2(
    revenues +
    (saleValue ?? 0) -
    acquisitionValue -
    totalOperationalCosts,
  )

  // ROI = resultado / aquisição × 100% (RN-043)
  const roi = acquisitionValue > 0
    ? round2((net_result / acquisitionValue) * 100)
    : null

  return { net_result, roi, total_costs: totalOperationalCosts }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
