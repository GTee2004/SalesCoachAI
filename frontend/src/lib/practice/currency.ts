import type { Currency } from '#/db/schema'

const formatters: Record<Currency, Intl.NumberFormat> = {
  VND: new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    currencyDisplay: 'code',
    maximumFractionDigits: 0,
  }),
}

export function formatCurrency(amount: number, currency: Currency) {
  return formatters[currency].format(amount)
}

export function formatVndInput(value: string) {
  // Keep invalid imported values visible so validation can explain the issue.
  return /^\d+$/.test(value)
    ? value.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    : value
}

export function editVndInput(
  previousValue: string,
  text: string,
  caret: number,
  inputType = '',
) {
  const previousText = formatVndInput(previousValue)
  const withoutCurrency = text.replace(/\s*VND\s*$/i, '')
  if (!/^[\d.,\s₫]*$/.test(withoutCurrency)) {
    return { value: previousValue, caret: Math.min(caret, previousText.length) }
  }

  // Deleting only a grouping separator should also delete the adjacent digit.
  if (
    previousText === `${text.slice(0, caret)}.${text.slice(caret)}` &&
    text.replace(/\D/g, '') === previousValue
  ) {
    if (inputType === 'deleteContentBackward' && caret > 0) {
      text = text.slice(0, caret - 1) + text.slice(caret)
      caret--
    } else if (inputType === 'deleteContentForward') {
      text = text.slice(0, caret) + text.slice(caret + 1)
    }
  }

  const digits = text.replace(/\D/g, '')
  const value = digits.replace(/^0+(?=\d)/, '')
  const digitsBeforeCaret = Math.max(
    0,
    text.slice(0, caret).replace(/\D/g, '').length -
      (digits.length - value.length),
  )
  const formatted = formatVndInput(value)
  let nextCaret = 0
  let seen = 0
  while (nextCaret < formatted.length && seen < digitsBeforeCaret) {
    if (/\d/.test(formatted[nextCaret])) seen++
    nextCaret++
  }
  return { value, caret: nextCaret }
}
