export type Folder = {
  id: string
  name: string
  sort_order: number
  created_at: string
}

export type Device = {
  id: string
  name: string
  folder_id: string | null
  folder_name: string | null
  hostname: string
  os_user: string
  last_ip: string | null
  local_ip: string | null
  connection_type: 'wifi' | 'ethernet' | 'unknown' | null
  latest_screenshot_path: string | null
  description: string | null
  notes: string | null
  status: 'active' | 'revoked'
  last_heartbeat_at: string | null
  last_capture_at: string | null
  capture_count: number
  created_at: string
  is_offline: boolean
}
