import { createContext } from 'svelte'

type SimplifiedModeSidebarActionContext = {
  setSidebarSimplifiedModeAction: (action: ((enabled: boolean) => Promise<void>) | null) => void
}

export const [getSimplifiedModeSidebarActionContext, setSimplifiedModeSidebarActionContext] =
  createContext<SimplifiedModeSidebarActionContext>()
