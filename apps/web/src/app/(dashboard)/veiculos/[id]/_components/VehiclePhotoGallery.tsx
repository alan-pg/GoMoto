'use client'

import Image from 'next/image'
import { VEHICLE_PHOTO_SLOT_LABELS, type VehiclePhotoSlot } from '@gomoto/core'

const SLOTS: VehiclePhotoSlot[] = ['principal', 'front', 'left_side', 'right_side', 'rear', 'dashboard']

interface Props {
  vehicleId: string
  photoUrls: Partial<Record<VehiclePhotoSlot, string>>
}

export default function VehiclePhotoGallery({ photoUrls }: Props) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
      {SLOTS.map((slot) => {
        const url = photoUrls[slot]
        return (
          <div key={slot} className="space-y-1.5">
            <div className="aspect-square rounded-xl overflow-hidden bg-[#202020] border border-[#323232] flex items-center justify-center">
              {url ? (
                <Image
                  src={url}
                  alt={VEHICLE_PHOTO_SLOT_LABELS[slot]}
                  width={160}
                  height={160}
                  className="w-full h-full object-cover"
                  unoptimized
                />
              ) : (
                <div className="flex flex-col items-center gap-1 text-[#474747]">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              )}
            </div>
            <p className="text-[11px] text-center text-[#9e9e9e]">
              {VEHICLE_PHOTO_SLOT_LABELS[slot]}
            </p>
          </div>
        )
      })}
    </div>
  )
}
