import { useEffect, useState } from 'react'
import { Cable, CalendarClock, HelpCircle, Save, Wifi, X } from 'lucide-react'
import type { Device } from './types'
import { fullDate, relativeTime } from './format'

function ConnectionBadge({ type }: { type: Device['connection_type'] }) {
  if (type === 'wifi') {
    return (
      <span className="flex items-center gap-1.5">
        <Wifi size={13} /> Wi-Fi
      </span>
    )
  }
  if (type === 'ethernet') {
    return (
      <span className="flex items-center gap-1.5">
        <Cable size={13} /> Cabeada
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-gray-500">
      <HelpCircle size={13} /> Desconhecida
    </span>
  )
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold tracking-wide text-gray-500">{label}</div>
      <div className="mt-0.5 text-sm text-gray-200">{children}</div>
    </div>
  )
}

export function DeviceDetailModal({
  device,
  thumbnailUrl,
  onClose,
  onSave,
}: {
  device: Device
  thumbnailUrl?: string
  onClose: () => void
  onSave: (
    deviceId: string,
    fields: { name?: string; description?: string | null; notes?: string | null },
  ) => Promise<boolean>
}) {
  const [nameDraft, setNameDraft] = useState(device.name)
  const [descriptionDraft, setDescriptionDraft] = useState(device.description ?? '')
  const [notesDraft, setNotesDraft] = useState(device.notes ?? '')
  const [saving, setSaving] = useState(false)

  // Reset drafts only when switching to a different device, not on every
  // realtime refresh of the same device (would clobber an in-progress edit).
  useEffect(() => {
    setNameDraft(device.name)
    setDescriptionDraft(device.description ?? '')
    setNotesDraft(device.notes ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.id])

  const dirty =
    nameDraft.trim() !== device.name ||
    descriptionDraft !== (device.description ?? '') ||
    notesDraft !== (device.notes ?? '')

  const save = async () => {
    const trimmedName = nameDraft.trim()
    if (!trimmedName) return
    setSaving(true)
    await onSave(device.id, {
      name: trimmedName,
      description: descriptionDraft.trim() || null,
      notes: notesDraft.trim() || null,
    })
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-800 bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
          <div className="min-w-0 flex-1">
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              className="w-full max-w-sm rounded-md border border-transparent bg-transparent font-mono text-sm font-semibold text-white outline-none transition hover:border-gray-700 focus:border-emerald-500 focus:bg-gray-950"
            />
            <div className="text-xs text-gray-400">
              {device.os_user} · {device.last_ip ?? 'IP desconhecido'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {dirty && (
              <button
                onClick={save}
                disabled={saving || !nameDraft.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:opacity-60"
              >
                <Save size={13} />
                {saving ? 'Salvando…' : 'Salvar alterações'}
              </button>
            )}
            <button onClick={onClose} className="rounded-md p-1.5 text-gray-400 hover:bg-white/5 hover:text-white">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-5 grid grid-cols-3 gap-4 rounded-xl border border-gray-800 bg-gray-950 p-4">
            <DetailRow label="IP PÚBLICO">{device.last_ip ?? 'desconhecido'}</DetailRow>
            <DetailRow label="IP LOCAL">{device.local_ip ?? 'desconhecido'}</DetailRow>
            <DetailRow label="CONEXÃO">
              <ConnectionBadge type={device.connection_type} />
            </DetailRow>
            <DetailRow label="INSTALADO EM">{fullDate(device.created_at)}</DetailRow>
            <DetailRow label="ÚLTIMA CONEXÃO">
              <span className="flex items-center gap-1.5">
                <CalendarClock size={13} />
                {fullDate(device.last_heartbeat_at)}
              </span>
            </DetailRow>
            <DetailRow label="PASTA">{device.folder_name ?? 'Sem pasta'}</DetailRow>
          </div>

          <div className="mb-5 grid grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-semibold tracking-wide text-gray-500">DESCRIÇÃO</label>
              <input
                value={descriptionDraft}
                onChange={(e) => setDescriptionDraft(e.target.value)}
                placeholder="Ex: PC do financeiro, 2º andar"
                className="mt-1 w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold tracking-wide text-gray-500">NOTAS</label>
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                placeholder="Observações internas sobre este dispositivo..."
                rows={1}
                className="mt-1 w-full resize-y rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-emerald-500"
              />
            </div>
          </div>

          {thumbnailUrl ? (
            <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-950">
              <img src={thumbnailUrl} alt="captura" className="w-full" />
              <div className="px-3 py-2 text-xs text-gray-400">
                Capturado {relativeTime(device.last_capture_at, Date.now())}
              </div>
            </div>
          ) : (
            <div className="py-16 text-center text-sm text-gray-500">
              Nenhuma captura registrada ainda para este dispositivo.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
