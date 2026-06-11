/**
 * @file MotorcycleMap.tsx
 * @description Componente de mapa interativo da frota GoMoto utilizando Leaflet.
 *
 * @funcionalidades
 * - Exibe marcadores coloridos por status (Disponível, Alugada, Manutenção, Inativa)
 * - Seletor de estilo de tiles: Padrão (CartoDB) e Satélite (Esri)
 * - FlyTo animado ao clicar em uma linha da tabela (via prop selectedMotoId)
 * - Sincronização de filtros: mostra/oculta marcadores conforme o filtro ativo na tabela
 * - Popup com dados completos da moto e locatário ao clicar no marcador
 * - Todas as motos sem GPS ficam centralizadas na sede até integração real dos rastreadores
 */

'use client' // Obrigatório: Leaflet manipula o DOM diretamente, incompatível com SSR

// CSS do Leaflet importado aqui pois é um Client Component.
// Em Next.js, CSS de pacotes npm pode ser importado diretamente em Client Components.
import 'leaflet/dist/leaflet.css'

import { useEffect, useRef, useState } from 'react'
import type { Motorcycle, Contract, Customer } from '@/types'
import { formatCurrency } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACES E TIPOS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dados que o mapa consome por marcador.
 * Combina a moto com seu contrato ativo e cliente para exibição no Popup.
 */
interface MotorcycleMapItem {
  motorcycle: Motorcycle
  contract?: Contract & { customer?: Customer }
}

/**
 * Props do componente MotorcycleMap.
 */
interface MotorcycleMapProps {
  /** Lista de motos com seus contratos/clientes para renderizar como marcadores */
  items: MotorcycleMapItem[]
  /** ID da moto selecionada na tabela — dispara o flyTo animado no mapa */
  selectedMotoId?: string | null
  /** IDs das motos visíveis conforme o filtro ativo na tabela — controla quais marcadores aparecem */
  visibleMotoIds?: string[]
  /** Posição padrão da sede GoMoto — usada enquanto rastreadores GPS não estão integrados */
  defaultCenter?: [number, number]
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES DE CONFIGURAÇÃO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estilos de tiles disponíveis no seletor do mapa.
 * Definidos fora do componente para evitar recriação a cada render.
 *
 * - Padrão: CartoDB Light — mapa limpo e legível para uso diário
 * - Satélite: Esri World Imagery — visão aérea real para identificar endereços
 * Ambos são gratuitos e não exigem API key.
 */
const TILE_STYLES = [
  {
    id: 'light',
    label: 'Padrão',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/">CARTO</a>',
  },
  {
    id: 'satellite',
    label: 'Satélite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© <a href="https://www.esri.com/">Esri</a>',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// FUNÇÕES AUXILIARES PURAS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retorna a cor hex do marcador baseada no status da moto.
 * As cores espelham os Badges da tabela para manter consistência visual no sistema.
 */
function getMarkerColor(status: string): string {
  switch (status) {
    case 'available':   return '#28b438' // Verde: disponível para locação
    case 'rented':      return '#a880ff' // Roxo: em contrato ativo
    case 'maintenance': return '#e65e24' // Laranja: indisponível por manutenção
    default:            return '#9e9e9e' // Cinza: inativa ou status desconhecido
  }
}

/**
 * Traduz o status interno (inglês) para português para exibição no Popup do mapa.
 */
function getStatusLabel(status: string): string {
  switch (status) {
    case 'available':   return 'Disponível'
    case 'rented':      return 'Alugada'
    case 'maintenance': return 'Manutenção'
    case 'inactive':    return 'Inativa'
    default:            return status
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @component MotorcycleMap
 *
 * DECISÕES TÉCNICAS IMPORTANTES:
 *
 * 1. useRef para a instância do mapa:
 *    O Leaflet manipula o DOM diretamente e não é serializável pelo React.
 *    Usar useState causaria erros e renders desnecessários — useRef mantém
 *    a referência estável sem acionar re-renders.
 *
 * 2. import() dinâmico dentro do useEffect:
 *    Leaflet depende de `window` e `document`, que não existem no servidor (SSR).
 *    O import dinâmico garante que o Leaflet só seja carregado no browser.
 *
 * 3. Flag `cancelled` no useEffect:
 *    React StrictMode (em desenvolvimento) monta → desmonta → remonta componentes.
 *    Como o import() é assíncrono, o cleanup pode rodar antes da promise resolver,
 *    causando o erro "Map container is already initialized". O flag previne isso.
 *
 * 4. markersRef como dicionário por ID:
 *    Permite acesso O(1) ao marcador de qualquer moto pelo ID,
 *    necessário para o flyTo acionado pela tabela sem percorrer todas as camadas.
 */
export default function MotorcycleMap({
  items,
  selectedMotoId,
  visibleMotoIds,
  defaultCenter = [-22.924523932502602, -43.685182991359035], // Sede GoMoto
}: MotorcycleMapProps) {

  // Referência ao elemento HTML onde o Leaflet irá injetar o mapa
  const mapRef = useRef<HTMLDivElement>(null)

  // Instância do mapa Leaflet — mantida em ref para não acionar re-renders do React
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null)

  // Referência à camada de tiles ativa — necessária para removê-la antes de trocar o estilo
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tileLayerRef = useRef<any>(null)

  /**
   * Dicionário: motorcycle.id → { marker, lat, lng }
   * Armazena as referências dos marcadores para operações externas (flyTo, show/hide).
   * Usar ref em vez de estado evita re-renders ao adicionar/remover marcadores.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<Record<string, { marker: any; lat: number; lng: number }>>({})

  // Controla qual estilo de tile está selecionado no seletor da UI (único estado React do componente)
  const [activeTile, setActiveTile] = useState('light')

  // ── INICIALIZAÇÃO DO MAPA ────────────────────────────────────────────────
  // Este effect roda apenas uma vez (array de deps vazio).
  // Toda a lógica de criação do mapa e marcadores fica aqui.
  useEffect(() => {
    // Guarda para não inicializar se o elemento DOM ainda não está pronto ou o mapa já existe
    if (!mapRef.current || mapInstanceRef.current) return

    // Flag de cancelamento: previne inicialização se o componente for desmontado
    // antes da promise do import() resolver (problema do React StrictMode em dev)
    let cancelled = false

    import('leaflet').then((L) => {
      // Checagens defensivas pós-async: o componente pode ter desmontado durante o import
      if (cancelled || !mapRef.current || mapInstanceRef.current) return

      // Leaflet persiste _leaflet_id no DOM — verificação extra para StrictMode
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((mapRef.current as any)._leaflet_id) return

      // Corrige caminhos dos ícones padrão do Leaflet que o webpack/Next.js não resolve corretamente
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      // Cria a instância do mapa no elemento DOM referenciado
      const map = L.map(mapRef.current!, {
        center: defaultCenter,
        zoom: 13,
        zoomControl: false,      // Desativado aqui para reposicionar manualmente abaixo
        attributionControl: true,
      })

      // Reposiciona o zoom (+/-) no canto inferior direito para não conflitar com o seletor de tiles
      L.control.zoom({ position: 'bottomright' }).addTo(map)

      mapInstanceRef.current = map

      // Carrega o tile inicial (Padrão/CartoDB Light)
      const initialStyle = TILE_STYLES.find((s) => s.id === 'light')!
      tileLayerRef.current = L.tileLayer(initialStyle.url, {
        attribution: initialStyle.attribution,
        maxZoom: 19,
      }).addTo(map)

      // ── CRIAÇÃO DOS MARCADORES ──────────────────────────────────────────
      items.forEach((item) => {
        const { motorcycle, contract } = item
        const color = getMarkerColor(motorcycle.status)

        /**
         * Enquanto os rastreadores GPS não estão integrados, todos os marcadores
         * ficam na posição exata da sede GoMoto.
         * O Popup informa o usuário que é uma posição simulada.
         * Futuramente: substituir lat/lng pelo valor real do rastreador vinculado à moto.
         */
        const lat = defaultCenter[0]
        const lng = defaultCenter[1]

        /**
         * Ícone customizado em formato de pin (gota rotacionada) usando HTML/CSS puro.
         * Vantagens sobre imagens: sem dependência de arquivo externo, cor dinâmica por status,
         * emoji de moto centralizado para identificação visual rápida.
         */
        const customIcon = L.divIcon({
          className: '', // Remove classe padrão do Leaflet que adiciona fundo branco
          html: `
            <div style="
              width: 36px; height: 36px;
              border-radius: 50% 50% 50% 0;
              transform: rotate(-45deg);
              background: ${color};
              border: 3px solid rgba(255,255,255,0.9);
              box-shadow: 0 2px 8px rgba(0,0,0,0.5);
              display: flex; align-items: center; justify-content: center;
            ">
              <div style="transform: rotate(45deg); font-size: 14px;">🏍️</div>
            </div>
          `,
          iconSize: [36, 36],
          iconAnchor: [18, 36],   // Ponto de âncora na ponta inferior do pin
          popupAnchor: [0, -42],  // Popup abre acima do marcador
        })

        // Valor semanal derivado do contrato: monthly_amount / 4 semanas
        const weeklyValue = contract?.monthly_amount
          ? formatCurrency(contract.monthly_amount / 4)
          : '—'

        /**
         * Conteúdo HTML do Popup — exibe ficha resumida da moto e locatário.
         * Usa HTML inline pois o Leaflet injeta o conteúdo fora do contexto React.
         * O aviso em vermelho informa que a posição é simulada até a integração GPS.
         */
        const popupContent = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; min-width: 220px; padding: 4px; color: #1a1a1a;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #e5e7eb;">
              <div style="width: 10px; height: 10px; border-radius: 50%; background: ${color}; flex-shrink: 0;"></div>
              <div>
                <p style="font-weight: 700; font-size: 14px; margin: 0;">${motorcycle.make} ${motorcycle.model}</p>
                <p style="font-size: 11px; color: #6b7280; margin: 2px 0 0;">${getStatusLabel(motorcycle.status)}</p>
              </div>
            </div>
            <table style="width: 100%; font-size: 12px; border-collapse: collapse;">
              <tr><td style="color:#6b7280; padding:3px 0; font-weight:600;">Placa</td><td style="font-weight:700; font-family:monospace; text-align:right;">${motorcycle.license_plate}</td></tr>
              <tr><td style="color:#6b7280; padding:3px 0; font-weight:600;">Ano</td><td style="text-align:right;">${motorcycle.year_manufacture}${motorcycle.year_model ? `/${motorcycle.year_model}` : ''}</td></tr>
              <tr><td style="color:#6b7280; padding:3px 0; font-weight:600;">Cliente</td><td style="text-align:right;">${contract?.customer?.name ?? '—'}</td></tr>
              <tr><td style="color:#6b7280; padding:3px 0; font-weight:600;">Valor/Semana</td><td style="color:#16a34a; font-weight:700; text-align:right;">${weeklyValue}</td></tr>
              <tr><td style="color:#6b7280; padding:3px 0; font-weight:600; vertical-align:top;">Endereço</td><td style="text-align:right; max-width:130px;">${contract?.customer?.address ?? '—'}</td></tr>
            </table>
            <p style="font-size:10px; color:#ef4444; margin-top:8px; padding-top:8px; border-top:1px solid #e5e7eb; text-align:center; font-weight:600;">⚠️ Posição simulada — rastreador GPS não vinculado</p>
          </div>
        `

        // Cria o marcador, adiciona ao mapa e guarda referência para interações futuras
        const marker = L.marker([lat, lng], { icon: customIcon })
          .addTo(map)
          .bindPopup(popupContent, { maxWidth: 280 })

        // Armazena no dicionário para acesso O(1) via ID — usado pelo flyTo e show/hide
        markersRef.current[motorcycle.id] = { marker, lat, lng }
      })
    })

    // Cleanup: remove o mapa ao desmontar e ativa o flag de cancelamento
    return () => {
      cancelled = true
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Deps vazio: inicializa apenas uma vez. Items são capturados no closure inicial.

  // ── TROCA DE TILES ───────────────────────────────────────────────────────
  // Roda quando o usuário clica em "Padrão" ou "Satélite" no seletor da UI.
  // Remove a camada anterior e adiciona a nova sem recriar o mapa inteiro.
  useEffect(() => {
    if (!mapInstanceRef.current) return
    const style = TILE_STYLES.find((s) => s.id === activeTile)
    if (!style) return

    import('leaflet').then((L) => {
      // Remove o tile layer anterior para evitar sobreposição de camadas
      if (tileLayerRef.current) {
        mapInstanceRef.current.removeLayer(tileLayerRef.current)
      }
      // Adiciona o novo tile layer e guarda a referência para a próxima troca
      tileLayerRef.current = L.tileLayer(style.url, {
        attribution: style.attribution,
        maxZoom: 19,
      }).addTo(mapInstanceRef.current)
    })
  }, [activeTile])

  // ── SINCRONIZAÇÃO COM FILTROS DA TABELA ──────────────────────────────────
  // Roda quando o filtro ativo na tabela muda (visibleMotoIds).
  // Mostra/oculta marcadores no mapa para refletir o que está na tabela.
  useEffect(() => {
    if (!mapInstanceRef.current) return

    import('leaflet').then((L) => {
      // Itera sobre todos os marcadores existentes e decide se devem aparecer
      Object.entries(markersRef.current).forEach(([id, data]) => {
        // Se visibleMotoIds não foi fornecido, todas são visíveis (sem filtro)
        const shouldShow = !visibleMotoIds || visibleMotoIds.includes(id)

        if (shouldShow) {
          // Adiciona ao mapa apenas se ainda não estiver lá (evita duplicação)
          if (!mapInstanceRef.current.hasLayer(data.marker)) {
            data.marker.addTo(mapInstanceRef.current)
          }
        } else {
          // Remove do mapa mas mantém em markersRef para poder reexibir depois
          if (mapInstanceRef.current.hasLayer(data.marker)) {
            mapInstanceRef.current.removeLayer(data.marker)
          }
        }
      })

      /**
       * Ajuste automático de zoom (flyToBounds) quando há filtro ativo:
       * - Com filtro parcial: foca nas motos visíveis com padding de 60px
       * - Sem filtro (todas visíveis): volta ao centro e zoom padrão da sede
       */
      if (visibleMotoIds && visibleMotoIds.length > 0 && visibleMotoIds.length < items.length) {
        const visibleData = visibleMotoIds
          .map((id) => markersRef.current[id])
          .filter(Boolean)
        if (visibleData.length > 0) {
          const bounds = L.latLngBounds(visibleData.map((d) => [d.lat, d.lng]))
          mapInstanceRef.current.flyToBounds(bounds, { padding: [60, 60], duration: 0.6 })
        }
      } else if (!visibleMotoIds || visibleMotoIds.length === items.length) {
        mapInstanceRef.current.flyTo(defaultCenter, 13, { duration: 0.6 })
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleMotoIds])

  // ── FlyTo: CENTRALIZA MOTO SELECIONADA NA TABELA ─────────────────────────
  // Roda quando o usuário clica em uma linha da tabela (selectedMotoId muda).
  // Anima a câmera do mapa até o marcador correspondente e abre o Popup.
  useEffect(() => {
    if (!selectedMotoId || !mapInstanceRef.current) return

    const data = markersRef.current[selectedMotoId]
    if (!data) return

    // flyTo com zoom 16 (nível de rua) e duração de 0.8s para transição suave
    mapInstanceRef.current.flyTo([data.lat, data.lng], 16, { duration: 0.8 })

    // Abre o Popup após a animação terminar (850ms ≈ duração do flyTo + margem)
    setTimeout(() => data.marker.openPopup(), 850)
  }, [selectedMotoId])

  // ── RENDERIZAÇÃO ─────────────────────────────────────────────────────────
  return (
    <div className="relative isolate w-full h-full">

      {/* Elemento DOM onde o Leaflet injeta o mapa — gerenciado pelo ref, não pelo React */}
      <div ref={mapRef} className="w-full h-full" />

      {/* Seletor de estilo de tiles — posicionado no canto superior esquerdo do mapa */}
      <div className="absolute top-3 left-3 z-[1000] flex gap-1 bg-[#121212]/85 backdrop-blur-sm border border-[#474747] rounded-lg p-1">
        {TILE_STYLES.map((style) => (
          <button
            key={style.id}
            onClick={() => setActiveTile(style.id)}
            className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-all ${
              // Destaca o tile ativo com a cor primária do sistema (verde-limão)
              activeTile === style.id
                ? 'bg-[#BAFF1A] text-black'
                : 'text-[#9e9e9e] hover:text-[#f5f5f5] hover:bg-white/5'
            }`}
          >
            {style.label}
          </button>
        ))}
      </div>

      {/* Badge de status do GPS — laranja pulsante indica que integração ainda não foi feita */}
      <div className="absolute top-3 right-3 z-[1000] bg-[#121212]/85 backdrop-blur-sm border border-[#474747] rounded-lg px-3 py-2 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-[#e65e24] animate-pulse" />
        <span className="text-xs text-[#9e9e9e] font-medium">GPS em breve</span>
      </div>

    </div>
  )
}
