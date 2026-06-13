import { useAuth } from '../../src/contexts/auth'
import { PlaceholderScreen } from '../../src/components/PlaceholderScreen'

export default function ContratoTab() {
  const { session } = useAuth()
  const email = session?.user?.email ?? ''

  return (
    <PlaceholderScreen
      title="Meu contrato"
      subtitle={email ? `Logado como ${email}` : undefined}
      description={
        'Aqui vai entrar o contrato vigente do cliente: moto alugada (placa + modelo), datas de início e fim, valor mensal e status do contrato. Regras de exibição quando há mais de um contrato ainda precisam ser definidas.'
      }
    />
  )
}
