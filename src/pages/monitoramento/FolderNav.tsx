import { useState } from 'react'
import { Folder as FolderIcon, FolderPlus, Radio, Layers, Search, Trash2 } from 'lucide-react'
import type { Device, Folder } from './types'

export type FolderFilter = 'all' | 'unfiled' | string

export function FolderNav({
  folders,
  devices,
  selected,
  onSelect,
  onCreateFolder,
  onDeleteFolder,
}: {
  folders: Folder[]
  devices: Device[]
  selected: FolderFilter
  onSelect: (f: FolderFilter) => void
  onCreateFolder: (name: string) => Promise<void>
  onDeleteFolder: (folderId: string) => Promise<void>
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [folderSearch, setFolderSearch] = useState('')

  const unfiledCount = devices.filter((d) => !d.folder_id).length
  const visibleFolders = folders.filter((f) =>
    f.name.toLowerCase().includes(folderSearch.trim().toLowerCase()),
  )

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setCreating(false)
      return
    }
    await onCreateFolder(trimmed)
    setName('')
    setCreating(false)
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col rounded-2xl border border-gray-800 bg-gray-900 p-4">
      <div className="mb-2 px-1 text-[11px] font-semibold tracking-widest text-gray-500">VISÃO GERAL</div>
      <nav className="mb-6 flex flex-col gap-0.5">
        <NavItem
          icon={<Layers size={16} />}
          label="Todos os dispositivos"
          count={devices.length}
          active={selected === 'all'}
          onClick={() => onSelect('all')}
        />
        <NavItem
          icon={<Radio size={16} />}
          label="Sem pasta"
          count={unfiledCount}
          active={selected === 'unfiled'}
          onClick={() => onSelect('unfiled')}
        />
      </nav>

      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[11px] font-semibold tracking-widest text-gray-500">PASTAS</span>
        <button
          onClick={() => setCreating(true)}
          className="rounded-md p-1 text-gray-400 transition hover:bg-white/5 hover:text-white"
          title="Nova pasta"
        >
          <FolderPlus size={15} />
        </button>
      </div>

      <div className="relative mb-2 px-0.5">
        <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          value={folderSearch}
          onChange={(e) => setFolderSearch(e.target.value)}
          placeholder="Buscar pasta..."
          className="w-full rounded-lg border border-gray-800 bg-gray-950 py-1.5 pl-8 pr-2.5 text-xs text-white outline-none placeholder:text-gray-500 focus:border-emerald-500"
        />
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {visibleFolders.map((f) => (
          <NavItem
            key={f.id}
            icon={<FolderIcon size={16} />}
            label={f.name}
            count={devices.filter((d) => d.folder_id === f.id).length}
            active={selected === f.id}
            onClick={() => onSelect(f.id)}
            onDelete={async () => {
              if (!confirm(`Excluir a pasta "${f.name}"? Os dispositivos dela ficam sem pasta.`)) return
              if (selected === f.id) onSelect('all')
              await onDeleteFolder(f.id)
            }}
          />
        ))}
        {creating && (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={submit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') {
                setName('')
                setCreating(false)
              }
            }}
            placeholder="Nome da pasta"
            className="mx-0.5 rounded-lg border border-gray-800 bg-gray-950 px-2.5 py-1.5 text-sm text-white outline-none placeholder:text-gray-500 focus:border-emerald-500"
          />
        )}
      </nav>

      <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Agente ativo
        </div>
        <div className="mt-1 text-[11px] leading-snug text-gray-400">
          Captura a cada 30 min · autostart Windows
        </div>
      </div>
    </aside>
  )
}

function NavItem({
  icon,
  label,
  count,
  active,
  onClick,
  onDelete,
}: {
  icon: React.ReactNode
  label: string
  count: number
  active: boolean
  onClick: () => void
  onDelete?: () => void
}) {
  return (
    <div
      className={`group flex items-center justify-between rounded-lg px-2.5 py-2 text-sm transition ${
        active ? 'bg-emerald-500/10 text-emerald-400' : 'text-gray-300 hover:bg-white/5 hover:text-white'
      }`}
    >
      <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        {icon}
        <span className="truncate">{label}</span>
      </button>

      {onDelete ? (
        <>
          <span
            className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium group-hover:hidden ${
              active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-gray-400'
            }`}
          >
            {count}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="hidden rounded-md p-1 text-gray-500 hover:bg-red-500/10 hover:text-red-400 group-hover:flex"
            title="Excluir pasta"
          >
            <Trash2 size={13} />
          </button>
        </>
      ) : (
        <span
          className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
            active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-gray-400'
          }`}
        >
          {count}
        </span>
      )}
    </div>
  )
}
