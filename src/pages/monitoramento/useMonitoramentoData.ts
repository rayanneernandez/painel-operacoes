import { useCallback, useEffect, useMemo, useState } from 'react'
import supabase from '@/lib/supabase'
import type { Device, Folder } from './types'

const SIGNED_URL_TTL = 60 * 60

export function useMonitoramentoData() {
  const [folders, setFolders] = useState<Folder[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const [syncingUntil, setSyncingUntil] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => Date.now())

  const loadThumbnailFor = useCallback(async (deviceId: string, path: string) => {
    const { data } = await supabase.storage.from('printview_screenshots').createSignedUrl(path, SIGNED_URL_TTL)
    if (data?.signedUrl) {
      setThumbnails((prev) => ({ ...prev, [deviceId]: data.signedUrl }))
    }
  }, [])

  const loadAll = useCallback(async () => {
    const [foldersRes, devicesRes] = await Promise.all([
      supabase.from('printview_folders').select('*').order('sort_order', { ascending: true }),
      supabase.from('printview_device_status').select('*').order('name', { ascending: true }),
    ])

    const deviceRows = (devicesRes.data ?? []) as Device[]
    setFolders((foldersRes.data ?? []) as Folder[])
    setDevices(deviceRows)

    for (const d of deviceRows) {
      if (d.latest_screenshot_path) loadThumbnailFor(d.id, d.latest_screenshot_path)
    }

    setLoading(false)
  }, [loadThumbnailFor])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 20_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel('printview-monitoramento')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'printview_devices' }, (payload) => {
        const oldRow = payload.old as { id?: string; last_capture_at?: string } | null
        const newRow = payload.new as
          | { id?: string; last_capture_at?: string; latest_screenshot_path?: string }
          | null
        if (newRow?.id && oldRow?.last_capture_at !== newRow.last_capture_at && newRow.latest_screenshot_path) {
          loadThumbnailFor(newRow.id, newRow.latest_screenshot_path)
          setSyncingUntil((prev) => ({ ...prev, [newRow.id!]: Date.now() + 3000 }))
        }
        loadAll()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'printview_folders' }, () => {
        loadAll()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadAll, loadThumbnailFor])

  const createFolder = useCallback(
    async (name: string) => {
      await supabase.from('printview_folders').insert({ name, sort_order: folders.length })
      await loadAll()
    },
    [folders.length, loadAll],
  )

  const deleteFolder = useCallback(
    async (folderId: string) => {
      await supabase.from('printview_folders').delete().eq('id', folderId)
      await loadAll()
    },
    [loadAll],
  )

  const moveDeviceToFolder = useCallback(async (deviceId: string, folderId: string | null) => {
    setDevices((prev) => prev.map((d) => (d.id === deviceId ? { ...d, folder_id: folderId } : d)))
    await supabase.from('printview_devices').update({ folder_id: folderId }).eq('id', deviceId)
  }, [])

  const updateDeviceInfo = useCallback(
    async (deviceId: string, fields: { name?: string; description?: string | null; notes?: string | null }) => {
      setDevices((prev) => prev.map((d) => (d.id === deviceId ? { ...d, ...fields } : d)))
      const { error } = await supabase.from('printview_devices').update(fields).eq('id', deviceId)
      if (error) alert(`Falha ao salvar: ${error.message}`)
      return !error
    },
    [],
  )

  const revokeDevice = useCallback(async (deviceId: string) => {
    setDevices((prev) => prev.map((d) => (d.id === deviceId ? { ...d, status: 'revoked' } : d)))
    const { error } = await supabase.from('printview_devices').update({ status: 'revoked' }).eq('id', deviceId)
    if (error) alert(`Falha ao revogar: ${error.message}`)
  }, [])

  const isSyncing = useCallback(
    (deviceId: string) => {
      const expiry = syncingUntil[deviceId]
      return !!expiry && expiry > now
    },
    [syncingUntil, now],
  )

  const capturesToday = useMemo(() => {
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    return devices.filter((d) => d.last_capture_at && new Date(d.last_capture_at) >= startOfDay).length
  }, [devices])

  return {
    folders,
    devices,
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
    refresh: loadAll,
  }
}
