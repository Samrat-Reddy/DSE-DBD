import { useEffect, useState } from 'react'

/**
 * Delay propagating a fast-changing value (such as a search box) so the
 * service layer is not queried on every keystroke.
 */
export const useDebouncedValue = (value, delayMs = 300) => {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}

export default useDebouncedValue
