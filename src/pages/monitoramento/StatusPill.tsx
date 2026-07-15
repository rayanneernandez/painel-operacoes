import { RefreshCw, ShieldOff, Wifi, WifiOff } from 'lucide-react'

export type DeviceStatus = 'online' | 'offline' | 'syncing' | 'revoked'

const STYLES: Record<DeviceStatus, string> = {
  online: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  offline: 'bg-white/10 text-gray-300 border-white/10',
  syncing: 'bg-teal-500/15 text-teal-400 border-teal-500/20',
  revoked: 'bg-red-500/15 text-red-400 border-red-500/20',
}

const LABELS: Record<DeviceStatus, string> = {
  online: 'Online',
  offline: 'Offline',
  syncing: 'Sincronizando',
  revoked: 'Revogado',
}

export function StatusPill({ status }: { status: DeviceStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium backdrop-blur-sm ${STYLES[status]}`}
    >
      {status === 'online' && <Wifi size={12} />}
      {status === 'offline' && <WifiOff size={12} />}
      {status === 'syncing' && <RefreshCw size={12} className="animate-spin" />}
      {status === 'revoked' && <ShieldOff size={12} />}
      {LABELS[status]}
    </span>
  )
}
