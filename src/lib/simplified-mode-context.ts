import { createContext } from 'svelte'

type SimplifiedModeContext = {
  openSimplifiedMode: () => Promise<void>
}

export const [getSimplifiedModeContext, setSimplifiedModeContext] =
  createContext<SimplifiedModeContext>()
