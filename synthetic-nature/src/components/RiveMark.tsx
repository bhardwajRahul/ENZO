/**
 * RiveMark.tsx — a slot for a Rive animation in the chrome.
 *
 * Renders a small Rive canvas only when a .riv file exists at
 * public/rive/<name>.riv — no file, no element, no dead space. Drop a .riv in
 * (exported from the Rive editor) and this lights up; nothing in the app waits
 * on it.
 */

import { useEffect, useState } from 'react'
import { useRive } from '@rive-app/react-canvas'

export default function RiveMark({ name = 'mark', size = 18 }: { name?: string; size?: number }) {
  const [present, setPresent] = useState<boolean | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/rive/${name}.riv`, { method: 'HEAD' })
      .then((r) => { if (live) setPresent(r.ok) })
      .catch(() => { if (live) setPresent(false) })
    return () => { live = false }
  }, [name])

  if (present === null || !present) return null
  return <RiveCanvas name={name} size={size} />
}

function RiveCanvas({ name, size }: { name: string; size: number }) {
  const { RiveComponent } = useRive({ src: `/rive/${name}.riv`, autoplay: true })
  return <RiveComponent style={{ width: size, height: size }} className="shrink-0" />
}
