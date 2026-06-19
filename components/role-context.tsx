"use client";

import { createContext, useContext } from "react";

// Cosmetic write-gating for the UI. The real enforcement is requireOwner() on
// the server actions / write routes — this just hides controls a viewer can't
// use so they don't see dead buttons.
const CanWriteContext = createContext(false);

export function RoleProvider({
  canWrite,
  children,
}: {
  canWrite: boolean;
  children: React.ReactNode;
}) {
  return (
    <CanWriteContext.Provider value={canWrite}>
      {children}
    </CanWriteContext.Provider>
  );
}

export function useCanWrite(): boolean {
  return useContext(CanWriteContext);
}
