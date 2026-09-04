import { useEffect, useMemo, useState } from 'react'
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
import { useSupabaseContext, useRequiredTenantId, usePeriodicInspectionProfileForRental } from '@gomoto/data'
import type { InspectionScheduleWithStatus } from '@gomoto/core'
import { supabase } from '../../lib/supabase'
import { useTheme, type ThemeTokens } from '../../theme'

type AnswerDraft = { status: 'ok' | 'not_ok' | null; note: string }
type PhotoDraft = { uri: string; storage_path: string | null; uploading: boolean }

type Props = {
  schedule: InspectionScheduleWithStatus | null
  onClose: () => void
  onSubmitted: () => void
}

function guessTypeFromUri(uri: string): string {
  const lower = uri.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}

async function submitInspection(scheduleId: string, payload: unknown) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Não autenticado')
  const webUrl = process.env.EXPO_PUBLIC_WEB_URL ?? ''
  if (!webUrl) throw new Error('EXPO_PUBLIC_WEB_URL não configurado')
  const res = await fetch(`${webUrl}/api/inspections/schedules/${scheduleId}/submit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const json = await res.json()
  if (!json.ok) throw new Error(json.error?.message ?? 'Falha ao enviar vistoria')
  return json.data as { id: string }
}

export function InspectionSubmitModal({ schedule, onClose, onSubmitted }: Props) {
  const client = useSupabaseContext()
  const getTenantId = useRequiredTenantId()
  const profileQuery = usePeriodicInspectionProfileForRental(schedule?.rental_id)

  const [answers, setAnswers] = useState<Record<string, AnswerDraft>>({})
  const [photos, setPhotos] = useState<Record<string, PhotoDraft>>({})
  const [submitting, setSubmitting] = useState(false)
  const theme = useTheme()
  const styles = useMemo(() => createStyles(theme), [theme])

  useEffect(() => {
    if (!schedule) {
      setAnswers({})
      setPhotos({})
    }
  }, [schedule])

  useEffect(() => {
    if (!profileQuery.data) return
    const nextAnswers: Record<string, AnswerDraft> = {}
    for (const item of profileQuery.data.checklist_items ?? []) nextAnswers[item.id] = { status: null, note: '' }
    setAnswers(nextAnswers)
    const nextPhotos: Record<string, PhotoDraft> = {}
    for (const item of profileQuery.data.photo_items ?? []) nextPhotos[item.id] = { uri: '', storage_path: null, uploading: false }
    setPhotos(nextPhotos)
  }, [profileQuery.data])

  async function pickPhoto(itemId: string) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert('Permissão negada', 'Precisamos de acesso às fotos para anexar a vistoria.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 })
    if (result.canceled || !result.assets[0]) return
    const asset = result.assets[0]

    setPhotos((prev) => ({ ...prev, [itemId]: { uri: asset.uri, storage_path: null, uploading: true } }))
    try {
      const res = await fetch(asset.uri)
      const buf = await res.arrayBuffer()
      const contentType = asset.mimeType ?? guessTypeFromUri(asset.uri)
      const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg'
      const tenantId = getTenantId()
      // inspection_id ainda não existe neste ponto (só nasce ao submeter) —
      // usa schedule_id como âncora do path, igualmente única por tenant.
      const path = `${tenantId}/${schedule!.id}/${itemId}.${ext}`
      const { error } = await client.storage.from('inspection-photos').upload(path, buf, { contentType, upsert: true })
      if (error) {
        Alert.alert('Erro no upload', error.message)
        setPhotos((prev) => ({ ...prev, [itemId]: { uri: '', storage_path: null, uploading: false } }))
        return
      }
      setPhotos((prev) => ({ ...prev, [itemId]: { uri: asset.uri, storage_path: path, uploading: false } }))
    } catch (err: unknown) {
      Alert.alert('Erro no upload', err instanceof Error ? err.message : 'Erro desconhecido')
      setPhotos((prev) => ({ ...prev, [itemId]: { uri: '', storage_path: null, uploading: false } }))
    }
  }

  async function handleSubmit() {
    if (!schedule || !profileQuery.data) return
    const checklistItems = profileQuery.data.checklist_items ?? []
    const photoItems = profileQuery.data.photo_items ?? []

    for (const item of checklistItems) {
      if (!answers[item.id]?.status) {
        Alert.alert('Checklist incompleto', `Responda o item "${item.name}".`)
        return
      }
    }
    const missing = photoItems.find((item) => item.is_required && !photos[item.id]?.storage_path)
    if (missing) {
      Alert.alert('Foto obrigatória', `Envie a foto "${missing.label}".`)
      return
    }

    setSubmitting(true)
    try {
      await submitInspection(schedule.id, {
        answers: checklistItems.map((item) => ({
          item_id: item.id,
          status: answers[item.id].status,
          note: answers[item.id].note.trim() || undefined,
        })),
        photos: photoItems
          .filter((item) => photos[item.id]?.storage_path)
          .map((item) => ({ item_id: item.id, storage_path: photos[item.id].storage_path })),
      })
      Alert.alert('Vistoria enviada', 'A locadora vai analisar e confirmar em breve.')
      onSubmitted()
    } catch (err: unknown) {
      Alert.alert('Não foi possível enviar', err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setSubmitting(false)
    }
  }

  if (!schedule) return null

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Text style={styles.title}>Vistoria periódica</Text>
          <Pressable onPress={onClose} disabled={submitting} hitSlop={12}>
            <Text style={styles.closeText}>Fechar</Text>
          </Pressable>
        </View>

        {profileQuery.isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={theme.primary} size="large" />
          </View>
        ) : !profileQuery.data ? (
          <View style={styles.centered}>
            <Text style={styles.emptyText}>Não foi possível carregar o checklist desta vistoria.</Text>
          </View>
        ) : (
          <>
            <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
              <Text style={styles.sectionLabel}>Checklist</Text>
              {(profileQuery.data.checklist_items ?? []).map((item) => {
                const draft = answers[item.id]
                return (
                  <View key={item.id} style={styles.checklistCard}>
                    <Text style={styles.checklistName}>{item.name}</Text>
                    <View style={styles.checklistBtnRow}>
                      <Pressable
                        style={[styles.checklistBtn, draft?.status === 'ok' && styles.checklistBtnOk]}
                        onPress={() => setAnswers((prev) => ({ ...prev, [item.id]: { ...prev[item.id], status: 'ok' } }))}
                      >
                        <Text style={[styles.checklistBtnText, draft?.status === 'ok' && styles.checklistBtnTextOk]}>OK</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.checklistBtn, draft?.status === 'not_ok' && styles.checklistBtnNotOk]}
                        onPress={() => setAnswers((prev) => ({ ...prev, [item.id]: { ...prev[item.id], status: 'not_ok' } }))}
                      >
                        <Text style={[styles.checklistBtnText, draft?.status === 'not_ok' && styles.checklistBtnTextNotOk]}>Não OK</Text>
                      </Pressable>
                    </View>
                    <TextInput
                      value={draft?.note ?? ''}
                      onChangeText={(v) => setAnswers((prev) => ({ ...prev, [item.id]: { ...prev[item.id], note: v } }))}
                      placeholder="Observação (opcional)"
                      placeholderTextColor={theme.textMute}
                      style={styles.noteInput}
                    />
                  </View>
                )
              })}

              <Text style={styles.sectionLabel}>Fotos</Text>
              <View style={styles.photoGrid}>
                {(profileQuery.data.photo_items ?? []).map((item) => {
                  const draft = photos[item.id]
                  return (
                    <Pressable key={item.id} style={styles.photoSlot} onPress={() => pickPhoto(item.id)}>
                      {draft?.uploading ? (
                        <ActivityIndicator color={theme.primary} />
                      ) : draft?.uri ? (
                        <Image source={{ uri: draft.uri }} style={styles.photoThumb} />
                      ) : (
                        <Text style={styles.photoSlotText}>Toque para fotografar</Text>
                      )}
                      <Text style={styles.photoSlotLabel} numberOfLines={1}>
                        {item.label} {item.is_required ? '*' : ''}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            </ScrollView>
            <View style={styles.footer}>
              <Pressable
                style={({ pressed }) => [styles.submitBtn, pressed && styles.submitBtnPressed, submitting && styles.submitBtnDisabled]}
                onPress={handleSubmit}
                disabled={submitting}
              >
                {submitting ? <ActivityIndicator color={theme.primaryContrast} /> : <Text style={styles.submitText}>Enviar vistoria</Text>}
              </Pressable>
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </Modal>
  )
}

const createStyles = (theme: ThemeTokens) => StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.bg },
  header: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomColor: theme.surfaceAlt,
    borderBottomWidth: 1,
  },
  title: { color: theme.text, fontSize: 18, fontWeight: '700' },
  closeText: { color: theme.primary, fontSize: 14, fontWeight: '600' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  emptyText: { color: theme.textMute, fontSize: 13, textAlign: 'center' },
  body: { flex: 1 },
  bodyContent: { padding: 20, paddingBottom: 40, gap: 10 },
  sectionLabel: {
    color: theme.textMute,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 10,
    marginBottom: 4,
  },
  checklistCard: {
    backgroundColor: theme.surface,
    borderColor: theme.surfaceAlt,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  checklistName: { color: theme.text, fontSize: 14, fontWeight: '600' },
  checklistBtnRow: { flexDirection: 'row', gap: 8 },
  checklistBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: theme.surfaceAlt,
  },
  checklistBtnOk: { backgroundColor: theme.success },
  checklistBtnNotOk: { backgroundColor: theme.danger },
  checklistBtnText: { color: theme.textMute, fontSize: 12, fontWeight: '700' },
  checklistBtnTextOk: { color: 'white' },
  checklistBtnTextNotOk: { color: 'white' },
  noteInput: {
    backgroundColor: theme.surfaceAlt,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: theme.text,
    fontSize: 12,
  },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoSlot: {
    width: '31%',
    aspectRatio: 1,
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
    gap: 4,
  },
  photoSlotText: { color: theme.textMute, fontSize: 10, textAlign: 'center' },
  photoSlotLabel: { color: theme.textMute, fontSize: 10, textAlign: 'center' },
  photoThumb: { width: '100%', height: '70%', borderRadius: 6 },
  footer: { padding: 20, borderTopColor: theme.surfaceAlt, borderTopWidth: 1 },
  submitBtn: { backgroundColor: theme.primary, paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  submitBtnPressed: { opacity: 0.85 },
  submitBtnDisabled: { opacity: 0.5 },
  submitText: { color: theme.primaryContrast, fontSize: 14, fontWeight: '700' },
})
