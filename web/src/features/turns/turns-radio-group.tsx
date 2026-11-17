import { useRef, type CSSProperties, type KeyboardEvent } from "react"
import { resolveRadioKeyTargetIndex } from "./turns-helpers"

export interface TurnsRadioOption<T extends string> {
  id: T
  label: string
  testId?: string
}

interface TurnsRadioGroupProps<T extends string> {
  ariaLabel: string
  options: readonly TurnsRadioOption<T>[]
  value: T | undefined
  onValueChange: (nextValue: T) => void
  className?: string
  style?: CSSProperties
  itemClassName?: string
  getItemStyle?: (option: TurnsRadioOption<T>, selected: boolean) => CSSProperties | undefined
}

/**
 * Accessible radiogroup with roving tabIndex and Arrow/Home/End keyboard navigation.
 * When `value` is undefined (e.g. a separate date-picker preset is active), the first
 * item remains tabbable so keyboard users can enter the group with one Tab.
 */
export function TurnsRadioGroup<T extends string>({
  ariaLabel,
  options,
  value,
  onValueChange,
  className,
  style,
  itemClassName,
  getItemStyle,
}: TurnsRadioGroupProps<T>) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = options.findIndex((opt) => opt.id === value)
  const activeTabIndex = selectedIndex >= 0 ? selectedIndex : 0

  const focusAndSelect = (index: number) => {
    const target = options[index]
    if (!target) return
    onValueChange(target.id)
    buttonRefs.current[index]?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex = resolveRadioKeyTargetIndex(event.key, index, options.length)
    if (nextIndex === null) return
    event.preventDefault()
    focusAndSelect(nextIndex)
  }

  return (
    <div role="radiogroup" aria-label={ariaLabel} className={className} style={style}>
      {options.map((opt, index) => {
        const selected = value === opt.id
        return (
          <button
            key={opt.id}
            ref={(el) => {
              buttonRefs.current[index] = el
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === activeTabIndex ? 0 : -1}
            onClick={() => onValueChange(opt.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={itemClassName}
            style={getItemStyle?.(opt, selected)}
            data-testid={opt.testId}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
