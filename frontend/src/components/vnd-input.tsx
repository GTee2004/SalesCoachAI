import { useLayoutEffect, useRef, useState } from 'react'
import type { ComponentProps } from 'react'
import { Input } from '#/components/ui/input'
import { editVndInput, formatVndInput } from '#/lib/practice/currency'

export function VndInput({
  value,
  onValueChange,
  ...props
}: Omit<ComponentProps<'input'>, 'type' | 'value' | 'onChange'> & {
  value: string
  onValueChange: (value: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [selection, setSelection] = useState<{ caret: number } | null>(null)

  useLayoutEffect(() => {
    if (selection && document.activeElement === inputRef.current) {
      inputRef.current?.setSelectionRange(selection.caret, selection.caret)
    }
  }, [selection, value])

  return (
    <Input
      {...props}
      ref={inputRef}
      type="text"
      inputMode="numeric"
      value={formatVndInput(value)}
      onChange={(event) => {
        const input = event.currentTarget
        const edit = editVndInput(
          value,
          input.value,
          input.selectionStart ?? input.value.length,
          (event.nativeEvent as InputEvent).inputType,
        )
        onValueChange(edit.value)
        setSelection({ caret: edit.caret })
      }}
    />
  )
}
