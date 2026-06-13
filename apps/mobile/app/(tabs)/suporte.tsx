import { Pressable, StyleSheet, Text } from 'react-native'

import { useAuth } from '../../src/contexts/auth'
import { PlaceholderScreen } from '../../src/components/PlaceholderScreen'

export default function SuporteTab() {
  const { signOut } = useAuth()

  return (
    <PlaceholderScreen
      title="Suporte"
      description={
        'Telefone e WhatsApp do operador do tenant ativo, lidos da tabela `companies`. A lista de canais (email, horário de atendimento) e os deep links pra ligação/WhatsApp serão definidos na próxima fase.'
      }
      footer={
        <Pressable style={styles.signOut} onPress={signOut}>
          <Text style={styles.signOutText}>Sair</Text>
        </Pressable>
      }
    />
  )
}

const styles = StyleSheet.create({
  signOut: {
    borderColor: '#474747',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  signOutText: {
    color: '#f5f5f5',
    fontSize: 15,
    fontWeight: '600',
  },
})
