"use client";

import { useAuth } from "@clerk/nextjs";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface WorkspaceState {
  activeBranchId: string | null;
  setActiveBranchId: (branchId: string | null) => void;
}

const WorkspaceContext = createContext<WorkspaceState>({
  activeBranchId: null,
  setActiveBranchId: () => undefined,
});

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { orgId } = useAuth();
  const [selection, setSelection] = useState<{ orgId: string | null; branchId: string | null }>({
    orgId: null,
    branchId: null,
  });

  useEffect(() => {
    setSelection({ orgId, branchId: null });
  }, [orgId]);

  const activeBranchId = selection.orgId === orgId ? selection.branchId : null;
  const setActiveBranchId = useCallback(
    (branchId: string | null) => setSelection({ orgId, branchId }),
    [orgId]
  );
  const value = useMemo(
    () => ({ activeBranchId, setActiveBranchId }),
    [activeBranchId, setActiveBranchId]
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceState {
  return useContext(WorkspaceContext);
}
