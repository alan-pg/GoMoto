import { PlaceholderScreen } from '../../src/components/PlaceholderScreen'

export default function ManutencoesTab() {
  return (
    <PlaceholderScreen
      title="Manutenções"
      description={
        'Próxima manutenção prevista da moto e histórico de concluídas. Definir quais campos (km, tipo, responsabilidade, custo) o cliente enxerga e quais ficam restritos ao admin.'
      }
    />
  )
}
