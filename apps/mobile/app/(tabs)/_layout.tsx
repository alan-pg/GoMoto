import { Tabs } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'

const ACTIVE = '#BAFF1A'
const INACTIVE = '#9e9e9e'

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <View style={styles.iconWrap}>
      <Text style={[styles.iconText, { color: focused ? ACTIVE : INACTIVE }]}>{label}</Text>
    </View>
  )
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: INACTIVE,
        tabBarStyle: {
          backgroundColor: '#181818',
          borderTopColor: '#323232',
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Início',
          tabBarIcon: ({ focused }) => <TabIcon label="⌂" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="cobrancas"
        options={{
          title: 'Cobranças',
          tabBarIcon: ({ focused }) => <TabIcon label="$" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="manutencoes"
        options={{
          title: 'Manutenções',
          tabBarIcon: ({ focused }) => <TabIcon label="M" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="vistorias"
        options={{
          title: 'Vistorias',
          tabBarIcon: ({ focused }) => <TabIcon label="V" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="suporte"
        options={{
          title: 'Conta',
          tabBarIcon: ({ focused }) => <TabIcon label="☰" focused={focused} />,
        }}
      />
    </Tabs>
  )
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 16,
    fontWeight: '700',
  },
})
