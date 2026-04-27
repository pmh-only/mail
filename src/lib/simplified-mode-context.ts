import { createContext } from 'svelte'

type SimplifiedModeContext = {
  openSimplifiedMode: () => Promise<void>
}

type SimplifiedModeMobileActionContext = {
  setMobileSimplifiedModeAction: (action: (() => Promise<void>) | null) => void
}

export const [getSimplifiedModeContext, setSimplifiedModeContext] =
  createContext<SimplifiedModeContext>()

export const [getSimplifiedModeMobileActionContext, setSimplifiedModeMobileActionContext] =
  createContext<SimplifiedModeMobileActionContext>()
