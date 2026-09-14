interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Labelled by the caller's own text (see ToggleSwitch in TerminalSection). */
  'aria-label'?: string
}

/**
 * Monochrome track-and-thumb toggle.
 *
 * ponytail: replaced a 385-line styled-components build with a button. The old
 * one nested eight divs to paint a grid layer, a ripple, a progress arc and a
 * status readout — the ripple, arc and readout were driven by classes
 * (`neo-activated`, `neo-progress`) nothing in the app ever set, and the
 * readout's markup didn't exist at all. It also ran on a 2s transition, which
 * is why it felt broken, and leaked a mint-green glow that broke the palette.
 */
export default function Switch({ checked, onChange, 'aria-label': ariaLabel }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`relative h-[18px] w-10 shrink-0 cursor-pointer rounded-full border transition-colors duration-150 ${
        checked ? 'border-white/25 bg-white/20' : 'border-white/10 bg-white/[0.04]'
      }`}
    >
      <span
        className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-[left,background-color] duration-150 ${
          checked ? 'left-[calc(100%-16px)] bg-white' : 'left-[2px] bg-white/40'
        }`}
      />
    </button>
  )
}
