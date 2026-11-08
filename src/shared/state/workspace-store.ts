import { create } from 'zustand'

interface WorkspaceState {
  branchId: string | null
  warehouseId: string | null
  setBranch: (branchId: string) => void
  setWarehouse: (warehouseId: string) => void
  clearWorkspace: () => void
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  branchId: null,
  warehouseId: null,
  setBranch: (branchId) => set({ branchId, warehouseId: null }),
  setWarehouse: (warehouseId) => set({ warehouseId }),
  clearWorkspace: () => set({ branchId: null, warehouseId: null }),
}))
