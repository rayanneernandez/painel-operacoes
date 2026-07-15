export function relativeTime(iso: string | null, now: number): string {
  if (!iso) return 'nunca'
  const diffMs = now - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours}h`
  const days = Math.floor(hours / 24)
  return `há ${days}d`
}

export function fullDate(iso: string | null): string {
  if (!iso) return 'nunca'
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export function isOffline(lastHeartbeatAt: string | null, now: number, thresholdMinutes = 15): boolean {
  if (!lastHeartbeatAt) return true
  return now - new Date(lastHeartbeatAt).getTime() > thresholdMinutes * 60_000
}
