/** Display positions are consecutive; event sequences remain stable evidence IDs. */
export function transcriptDisplayNumbers(
  turns: readonly { sequence?: number }[],
) {
  const numbers = new Map<number, number>()
  turns.forEach((turn, index) => {
    if (turn.sequence != null) numbers.set(turn.sequence, index + 1)
  })
  return numbers
}
