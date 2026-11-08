import { create } from 'zustand'

function readWorkspace(): { branchId: string | null; warehouseId: string | null } {
  if (typeof sessionStorage === 'undefined') {
    return { branchId: null, warehouseId: null }
  }
  const branchId = sessionStorage.getItem('safa.branchId')
  const warehouseId = sessionStorage.getItem('safa.warehouseId')
  return {
    branchId: branchId || null,
    warehouseId: branchId && warehouseId ? warehouseId : null,
  }
}

interface WorkspaceState {
  branchId: string | null
  warehouseId: string | null
  setBranch: (branchId: string) => void
  setWarehouse: (warehouseId: string) => void
  clearWarehouse: () => void
  clearWorkspace: () => void
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  ...readWorkspace(),
  setBranch: (branchId) => {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('safa.branchId', branchId)
      sessionStorage.removeItem('safa.warehouseId')
    }
    set({ branchId, warehouseId: null })
  },
  setWarehouse: (warehouseId) => {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('safa.warehouseId', warehouseId)
    }
    set({ warehouseId })
  },
  clearWarehouse: () => {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('safa.warehouseId')
    }
    set({ warehouseId: null })
  },
  clearWorkspace: () => {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('safa.branchId')
      sessionStorage.removeItem('safa.warehouseId')
    }
    set({ branchId: null, warehouseId: null })
  },
}))
