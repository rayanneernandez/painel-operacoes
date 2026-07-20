import { useMemo, useState } from 'react'
import { Camera, Search, Users, Wifi, WifiOff } from 'lucide-react'
import { FolderNav, type FolderFilter } from './FolderNav'
import { StatCard } from './StatCard'
import { DeviceCard } from './DeviceCard'
import { DeviceDetailModal } from './DeviceDetailModal'
import type { DeviceStatus } from './StatusPill'
import { useMonitoramentoData } from './useMonitoramentoData'
import { isOffline } from './format'
import type { Device } from './types'
import { useAuth } from '../../contexts/AuthContext'

export function Monitoramento() {
  const {
    folders: allFolders,
    devices: allDevices,
    thumbnails,
    capturesToday,
    loading,
    now,
    createFolder,
    deleteFolder,
    moveDeviceToFolder,
    updateDeviceInfo,
    revokeDevice,
    isSyncing,
  } = useMonitoramentoData()

  const { user } = useAuth()

  // Admins sempre veem tudo. Para os demais, o acesso é restrito às pastas e
  // aos dispositivos individuais liberados em Usuários -- sem nada liberado,
  // não vê nenhum dispositivo (ver src/pages/Users.tsx, aba Permissões).
  const isAdmin = user?.role === 'admin'
  const allowedFolderIds = useMemo(() => new Set(user?.permissions?.monitoring_folder_ids ?? []), [user])
  const allowedDeviceIds = useMemo(() => new Set(user?.permissions?.monitoring_device_ids ?? []), [user])

  const devices = useMemo(() => {
    if (isAdmin) return allDevices
    return allDevices.filter((d) => (d.folder_id && allowedFolderIds.has(d.folder_id)) || allowedDeviceIds.has(d.id))
  }, [allDevices, isAdmin, allowedFolderIds, allowedDeviceIds])

  const folders = useMemo(() => {
    if (isAdmin) return allFolders
    return allFolders.filter((f) => allowedFolderIds.has(f.id) || devices.some((d) => d.folder_id === f.id))
  }, [allFolders, isAdmin, allowedFolderIds, devices])

  const [selectedFolder, setSelectedFolder] = useState<FolderFilter>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline' | 'revoked'>('all')
  const [search, setSearch] = useState('')
  const [detailDeviceId, setDetailDeviceId] = useState<string | null>(null)
  // Derived from the live `devices` array (not a frozen snapshot) so realtime
  // updates and our own edits show up immediately while the modal is open.
  const detailDevice = detailDeviceId ? (devices.find((d) => d.id === detailDeviceId) ?? null) : null

  const statusOf = (d: Device): DeviceStatus => {
    if (d.status === 'revoked') return 'revoked'
    if (isOffline(d.last_heartbeat_at, now)) return 'offline'
    if (isSyncing(d.id)) return 'syncing'
    return 'online'
  }

  const onlineCount = devices.filter((d) => d.status === 'active' && !isOffline(d.last_heartbeat_at, now)).length
  const offlineCount = devices.filter((d) => d.status === 'active').length - onlineCount
  const revokedCount = devices.filter((d) => d.status === 'revoked').length

  const filtered = useMemo(() => {
    let list = devices
    if (selectedFolder === 'unfiled') list = list.filter((d) => !d.folder_id)
    else if (selectedFolder !== 'all') list = list.filter((d) => d.folder_id === selectedFolder)

    if (statusFilter === 'revoked') list = list.filter((d) => d.status === 'revoked')
    else if (statusFilter === 'online') list = list.filter((d) => d.status === 'active' && !isOffline(d.last_heartbeat_at, now))
    else if (statusFilter === 'offline') list = list.filter((d) => d.status === 'active' && isOffline(d.last_heartbeat_at, now))

    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.os_user.toLowerCase().includes(q) ||
          (d.last_ip ?? '').toLowerCase().includes(q) ||
          (d.folder_name ?? '').toLowerCase().includes(q),
      )
    }
    return list
  }, [devices, selectedFolder, statusFilter, search, now])

  const currentFolderName =
    selectedFolder === 'all'
      ? 'Todos os dispositivos'
      : selectedFolder === 'unfiled'
        ? 'Sem pasta'
        : (folders.find((f) => f.id === selectedFolder)?.name ?? 'Pasta')

  return (
    <div className="flex gap-5">
      <FolderNav
        folders={folders}
        devices={devices}
        selected={selectedFolder}
        onSelect={setSelectedFolder}
        onCreateFolder={createFolder}
        onDeleteFolder={deleteFolder}
      />

      <div className="flex-1">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-500">
              Monitoramento <span className="mx-1.5">›</span> {currentFolderName}
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-white">Monitoramento de Telas</h1>
          </div>

          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por dispositivo, usuário, IP ou pasta..."
              className="w-96 rounded-lg border border-gray-800 bg-gray-900 py-2 pl-9 pr-3 text-sm text-white outline-none placeholder:text-gray-500 focus:border-emerald-500"
            />
          </div>
        </div>

        <div className="mb-6 grid grid-cols-4 gap-4">
          <StatCard label="DISPOSITIVOS" value={devices.length} icon={Users} />
          <StatCard label="ONLINE" value={onlineCount} icon={Wifi} />
          <StatCard label="OFFLINE" value={offlineCount} icon={WifiOff} />
          <StatCard label="CAPTURAS HOJE" value={capturesToday} icon={Camera} />
        </div>

        <div className="mb-5 flex items-center gap-2">
          <FilterTab label="Todos" count={devices.length} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
          <FilterTab label="Online" count={onlineCount} active={statusFilter === 'online'} onClick={() => setStatusFilter('online')} />
          <FilterTab label="Offline" count={offlineCount} active={statusFilter === 'offline'} onClick={() => setStatusFilter('offline')} />
          <FilterTab
            label="Revogados"
            count={revokedCount}
            active={statusFilter === 'revoked'}
            onClick={() => setStatusFilter('revoked')}
          />
        </div>

        {loading ? (
          <div className="py-24 text-center text-sm text-gray-500">Carregando dispositivos…</div>
        ) : filtered.length === 0 ? (
          <div className="py-24 text-center text-sm text-gray-500">Nenhum dispositivo encontrado.</div>
        ) : (
          <div className="grid grid-cols-3 gap-5">
            {filtered.map((d) => (
              <DeviceCard
                key={d.id}
                device={d}
                status={statusOf(d)}
                thumbnailUrl={thumbnails[d.id]}
                now={now}
                folders={folders}
                onMoveToFolder={moveDeviceToFolder}
                onRevoke={revokeDevice}
                onOpenDetail={(dev) => setDetailDeviceId(dev.id)}
              />
            ))}
          </div>
        )}
      </div>

      {detailDevice && (
        <DeviceDetailModal
          device={detailDevice}
          thumbnailUrl={thumbnails[detailDevice.id]}
          onClose={() => setDetailDeviceId(null)}
          onSave={updateDeviceInfo}
        />
      )}
    </div>
  )
}

function FilterTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
        active
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
          : 'border-gray-800 bg-gray-900 text-gray-400 hover:text-white'
      }`}
    >
      {label}
      <span
        className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
          active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-gray-500'
        }`}
      >
        {count}
      </span>
    </button>
  )
}
