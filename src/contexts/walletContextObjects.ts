// The context objects live in their own module with type-only imports. Vite
// HMR re-runs a module when one of its dependencies changes; if these objects
// were re-created, mounted consumers would lose their provider and crash.
import { createContext } from "react";
import type { UseWalletReturn } from "@/hooks/useWallet";
import type { UseTokenBalanceReturn } from "@/hooks/useTokenBalance";

export const WalletStateContext = createContext<UseWalletReturn | null>(null);
export const TokenBalanceContext = createContext<UseTokenBalanceReturn | null>(null);
