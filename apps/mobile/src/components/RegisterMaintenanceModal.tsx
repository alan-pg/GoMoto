import { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useCreateMaintenanceRecord } from '@gomoto/data'
import type { Maintenance } from '@gomoto/core'

type PickedPhoto = {
  uri: string
  contentType: string
  body: ArrayBuffer
}

type Props = {
  visible: boolean
  onClose: () => void
  customerId: string
  maintenance: Maintenance | null
}

// Quando o cliente fecha uma preventiva agendada, vinculamos via maintenance_id.
// Quando o item ainda não está no plano (corretiva avulsa), maintenance fica null
// e a aprovação no web decide se cria uma `maintenances` ou descarta.
export function RegisterMaintenanceModal({ visible, onClose, customerId, maintenance }: Props) {
  const [actualKm, setActualKm] = useState('')
  const [workshop, setWorkshop] = useState('')
  const [cost, setCost] = useState('')
  const [notes, setNotes] = useState('')
  const [odometerPhoto, setOdometerPhoto] = useState<PickedPhoto | null>(null)
  const [invoicePhoto, setInvoicePhoto] = useState<PickedPhoto | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const create = useCreateMaintenanceRecord()

  function resetForm() {
    setActualKm('')
    setWorkshop('')
    setCost('')
    setNotes('')
    setOdometerPhoto(null)
    setInvoicePhoto(null)
  }

  function handleClose() {
    if (submitting) return
    resetForm()
    onClose()
  }

  async function pickPhoto(kind: 'odometer' | 'invoice') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert('Permissão negada', 'Precisamos de acesso às fotos para anexar o comprovante.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: false,
    })
    if (result.canceled || !result.assets[0]) return
    const asset = result.assets[0]
    // No RN, blob vindo de fetch(uri).blob() faz upload vazio no Supabase storage.
    // Convertendo pra ArrayBuffer o binário chega íntegro.
    const res = await fetch(asset.uri)
    const buf = await res.arrayBuffer()
    const contentType = asset.mimeType ?? guessTypeFromUri(asset.uri)
    const photo: PickedPhoto = { uri: asset.uri, contentType, body: buf }
    if (kind === 'odometer') setOdometerPhoto(photo)
    else setInvoicePhoto(photo)
  }

  async function handleSubmit() {
    if (!maintenance) return
    const kmNum = parseInt(actualKm.replace(/\D/g, ''), 10)
    if (!Number.isFinite(kmNum) || kmNum < 0) {
      Alert.alert('KM inválido', 'Informe a quilometragem atual da moto.')
      return
    }
    const costNum = cost.trim()
      ? Number(cost.replace(/\./g, '').replace(',', '.'))
      : null
    if (costNum != null && (!Number.isFinite(costNum) || costNum < 0)) {
      Alert.alert('Custo inválido', 'Informe um valor numérico (ex.: 250,00) ou deixe em branco.')
      return
    }
    if (!odometerPhoto) {
      Alert.alert('Foto do hodômetro', 'Tire uma foto do painel da moto para comprovar a KM.')
      return
    }
    setSubmitting(true)
    try {
      await create.mutateAsync({
        customer_id: customerId,
        motorcycle_id: maintenance.motorcycle_id,
        maintenance_id: maintenance.id,
        actual_km: kmNum,
        cost: costNum,
        workshop: workshop.trim() || null,
        notes: notes.trim() || null,
        odometer_photo: { body: odometerPhoto.body, contentType: odometerPhoto.contentType },
        invoice_photo: invoicePhoto
          ? { body: invoicePhoto.body, contentType: invoicePhoto.contentType }
          : null,
      })
      Alert.alert(
        'Enviado pra aprovação',
        'A locadora vai revisar e confirmar a manutenção. Você pode acompanhar pelo histórico.',
      )
      resetForm()
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido'
      Alert.alert('Não deu pra registrar', msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Registrar conclusão</Text>
          <Pressable onPress={handleClose} disabled={submitting} hitSlop={12}>
            <Text style={styles.closeText}>Fechar</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
          {maintenance ? (
            <View style={styles.summary}>
              <Text style={styles.summaryTitle}>{maintenance.description || maintenance.type}</Text>
              <Text style={styles.summaryMeta}>
                {maintenance.predicted_km
                  ? `KM previsto: ${maintenance.predicted_km.toLocaleString('pt-BR')}`
                  : 'Sem KM previsto'}
              </Text>
            </View>
          ) : null}

          <FieldLabel text="KM atual da moto *" />
          <TextInput
            value={actualKm}
            onChangeText={setActualKm}
            keyboardType="numeric"
            placeholder="Ex.: 45200"
            placeholderTextColor="#5a5a5a"
            style={styles.input}
          />

          <FieldLabel text="Oficina (opcional)" />
          <TextInput
            value={workshop}
            onChangeText={setWorkshop}
            placeholder="Nome da oficina"
            placeholderTextColor="#5a5a5a"
            style={styles.input}
          />

          <FieldLabel text="Custo total em R$ (opcional)" />
          <TextInput
            value={cost}
            onChangeText={setCost}
            keyboardType="decimal-pad"
            placeholder="Ex.: 250,00"
            placeholderTextColor="#5a5a5a"
            style={styles.input}
          />

          <FieldLabel text="Observações (opcional)" />
          <TextInput
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            placeholder="Peças trocadas, observações da oficina..."
            placeholderTextColor="#5a5a5a"
            style={[styles.input, styles.inputMultiline]}
          />

          <FieldLabel text="Foto do hodômetro *" />
          <PhotoSlot
            photo={odometerPhoto}
            onPress={() => pickPhoto('odometer')}
            onClear={() => setOdometerPhoto(null)}
          />

          <FieldLabel text="Foto da nota fiscal (opcional)" />
          <PhotoSlot
            photo={invoicePhoto}
            onPress={() => pickPhoto('invoice')}
            onClear={() => setInvoicePhoto(null)}
          />
        </ScrollView>
        <View style={styles.footer}>
          <Pressable
            style={({ pressed }) => [styles.submitBtn, pressed && styles.submitBtnPressed, submitting && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#121212" />
            ) : (
              <Text style={styles.submitText}>Enviar pra aprovação</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function FieldLabel({ text }: { text: string }) {
  return <Text style={styles.label}>{text}</Text>
}

function PhotoSlot({
  photo,
  onPress,
  onClear,
}: {
  photo: PickedPhoto | null
  onPress: () => void
  onClear: () => void
}) {
  if (photo) {
    return (
      <View style={styles.photoFilled}>
        <Image source={{ uri: photo.uri }} style={styles.photoThumb} />
        <View style={styles.photoActions}>
          <Pressable onPress={onPress}>
            <Text style={styles.photoActionText}>Trocar</Text>
          </Pressable>
          <Pressable onPress={onClear}>
            <Text style={[styles.photoActionText, styles.photoRemove]}>Remover</Text>
          </Pressable>
        </View>
      </View>
    )
  }
  return (
    <Pressable style={styles.photoEmpty} onPress={onPress}>
      <Text style={styles.photoEmptyText}>Toque para escolher uma foto</Text>
    </Pressable>
  )
}

function guessTypeFromUri(uri: string): string {
  const lower = uri.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.heic') || lower.endsWith('.heif')) return 'image/heic'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'image/jpeg'
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#121212' },
  header: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomColor: '#323232',
    borderBottomWidth: 1,
  },
  title: { color: '#f5f5f5', fontSize: 18, fontWeight: '700' },
  closeText: { color: '#BAFF1A', fontSize: 14, fontWeight: '600' },
  body: { flex: 1 },
  bodyContent: { padding: 20, paddingBottom: 40, gap: 6 },
  summary: {
    backgroundColor: '#202020',
    borderColor: '#323232',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  summaryTitle: { color: '#f5f5f5', fontSize: 14, fontWeight: '600' },
  summaryMeta: { color: '#9e9e9e', fontSize: 12, marginTop: 4 },
  label: { color: '#9e9e9e', fontSize: 12, marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: '#202020',
    borderColor: '#323232',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f5f5f5',
    fontSize: 14,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  photoEmpty: {
    backgroundColor: '#202020',
    borderColor: '#323232',
    borderStyle: 'dashed',
    borderWidth: 1,
    borderRadius: 10,
    padding: 18,
    alignItems: 'center',
  },
  photoEmptyText: { color: '#9e9e9e', fontSize: 13 },
  photoFilled: {
    backgroundColor: '#202020',
    borderColor: '#323232',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  photoThumb: { width: 72, height: 72, borderRadius: 8, backgroundColor: '#323232' },
  photoActions: { flex: 1, gap: 6 },
  photoActionText: { color: '#BAFF1A', fontSize: 13, fontWeight: '600' },
  photoRemove: { color: '#ff9c9a' },
  footer: {
    padding: 20,
    borderTopColor: '#323232',
    borderTopWidth: 1,
  },
  submitBtn: {
    backgroundColor: '#BAFF1A',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  submitBtnPressed: { opacity: 0.85 },
  submitBtnDisabled: { opacity: 0.5 },
  submitText: { color: '#121212', fontSize: 14, fontWeight: '700' },
})
