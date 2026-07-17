import { useState } from 'react'
import { Camera, Clock, Folder as FolderIcon, Maximize2, MoreVertical, Search, ShieldOff } from 'lucide-react'
import type { Device, Folder } from './types'
import { relativeTime } from './format'
import { StatusPill, type DeviceStatus } from './StatusPill'

export function DeviceCard({
  device,
  status,
  thumbnailUrl,
  now,
  folders,
  onMoveToFolder,
  onRevoke,
  onOpenDetail,
}: {
  device: Device
  status: DeviceStatus
  thumbnailUrl?: string
  now: number
  folders: Folder[]
  onMoveToFolder: (deviceId: string, folderId: string | null) => void
  onRevoke: (deviceId: string) => void
  onOpenDetail: (device: Device) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [folderSearch, setFolderSearch] = useState('')
  const visibleFolders = folders.filter((f) => f.name.toLowerCase().includes(folderSearch.trim().toLowerCase()))

  return (
    <div className="group relative rounded-2xl border border-gray-800 bg-gray-900">
      <div className="relative aspect-video overflow-hidden rounded-t-2xl bg-gray-950">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={device.name}
            className="h-full w-full object-cover opacity-90 blur-[2px] transition group-hover:blur-0"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-gray-600">
            <Camera size={22} />
          </div>
        )}

        <div className="absolute left-3 top-3">
          <StatusPill status={status} />
        </div>

        <button
          onClick={() => onOpenDetail(device)}
          className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 backdrop-blur-[1px] transition group-hover:opacity-100"
        >
          <span className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white shadow-lg">
            <Maximize2 size={14} />
            Ver captura
          </span>
        </button>
      </div>

      <div className="relative p-4">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="absolute right-3 top-3 rounded-md p-1 text-gray-500 transition hover:bg-white/5 hover:text-white"
        >
          <MoreVertical size={16} />
        </button>

        {menuOpen && (
          <div
            className="absolute bottom-full right-3 z-20 mb-2 flex max-h-[70vh] w-56 max-w-[85vw] flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-950 py-1 shadow-xl"
            onMouseLeave={() => {
              setMenuOpen(false)
              setFolderSearch('')
            }}
          >
            <div className="px-3 py-1.5 text-[11px] font-semibold tracking-wide text-gray-500">
              MOVER PARA PASTA
            </div>

            {folders.length > 5 && (
              <div className="relative mb-1 px-2">
                <Search size={12} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  autoFocus
                  value={folderSearch}
                  onChange={(e) => setFolderSearch(e.target.value)}
                  placeholder="Buscar pasta..."
                  className="w-full rounded-md border border-gray-800 bg-gray-900 py-1 pl-6 pr-2 text-xs text-white outline-none placeholder:text-gray-500 focus:border-emerald-500"
                />
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto">
              {visibleFolders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    onMoveToFolder(device.id, f.id)
                    setMenuOpen(false)
                    setFolderSearch('')
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-200 hover:bg-white/5"
                >
                  <FolderIcon size={13} className="shrink-0" />
                  <span className="truncate">{f.name}</span>
                </button>
              ))}
              {folders.length > 0 && visibleFolders.length === 0 && (
                <div className="px-3 py-2 text-xs text-gray-500">Nenhuma pasta encontrada.</div>
              )}
            </div>

            {device.folder_id && (
              <button
                onClick={() => {
                  onMoveToFolder(device.id, null)
                  setMenuOpen(false)
                  setFolderSearch('')
                }}
                className="w-full shrink-0 px-3 py-1.5 text-left text-sm text-gray-400 hover:bg-white/5"
              >
                Remover da pasta
              </button>
            )}
            {device.status !== 'revoked' && (
              <>
                <div className="my-1 shrink-0 border-t border-gray-800" />
                <button
                  onClick={() => {
                    onRevoke(device.id)
                    setMenuOpen(false)
                    setFolderSearch('')
                  }}
                  className="flex w-full shrink-0 items-center gap-2 px-3 py-1.5 text-left text-sm text-red-400 hover:bg-red-500/10"
                >
                  <ShieldOff size={13} />
                  Revogar acesso
                </button>
              </>
            )}
          </div>
        )}

        <div className="truncate pr-6 font-mono text-sm font-semibold text-white">{device.name}</div>
        <div className="mt-0.5 truncate text-xs text-gray-400">
          {device.os_user} · {device.last_ip ?? 'IP desconhecido'}
        </div>

        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-gray-500">
            <Clock size={12} />
            {relativeTime(device.last_heartbeat_at, now)}
          </span>
          <span className="font-semibold text-gray-300">{device.capture_count} capturas</span>
        </div>

        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-gray-500">
          <FolderIcon size={12} />
          {device.folder_name ?? 'Sem pasta'}
        </div>
      </div>
    </div>
  )
}
