import type { LucideIcon } from 'lucide-react'

export function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: number | string
  icon: LucideIcon
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-gray-800 bg-gray-900 px-5 py-4">
      <div>
        <div className="text-[11px] font-semibold tracking-widest text-gray-500">{label}</div>
        <div className="mt-1.5 text-3xl font-semibold text-white">{value}</div>
      </div>
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 text-gray-300">
        <Icon size={20} />
      </div>
    </div>
  )
}
