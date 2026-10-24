import { lazy, Suspense, useEffect } from "react";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import { SiteFooter } from "./components/SiteFooter";
import { SiteHeader } from "./components/SiteHeader";
import { NetworkChangeNotice } from "./components/NetworkChangeNotice";
import { navigate, useLocation } from "./hooks/useLocation";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";
import { WalletProvider } from "./contexts/WalletContext";

const LazyLeaderboardPage = lazy(() =>
  import("./components/leaderboard/LeaderboardPage").then((mod) => ({
    default: mod.LeaderboardPage,
  })),
);

const LazyTxPage = lazy(() =>
  import("./components/runs/TxPage").then((mod) => ({
    default: mod.TxPage,
  })),
);

const LazyRunsPage = lazy(() =>
  import("./components/runs/RunsPage").then((mod) => ({
    default: mod.RunsPage,
  })),
);

const LazyWalletPage = lazy(() =>
  import("./components/wallet/WalletPage").then((mod) => ({
    default: mod.WalletPage,
  })),
);

const LazyGamePage = lazy(() =>
  import("./components/game/GamePageWrapper").then((mod) => ({
    default: mod.GamePageWrapper,
  })),
);

const routeFallback = (
  <div className="flex min-h-[200px] items-center justify-center">
    <Loader2 className="size-6 animate-spin text-muted-foreground" />
  </div>
);

function App() {
  const pathname = useLocation();
  const isLegacyProofsPath = pathname === "/proofs" || pathname.startsWith("/proofs/");

  const addressPath = pathname.match(/^\/address\/([^/]+)/u)?.[1] ?? null;

  // Old proof pages became the run history; explorer-style address URLs open the player page.
  useEffect(() => {
    if (isLegacyProofsPath) {
      navigate("/runs", { replace: true });
    } else if (addressPath) {
      navigate(`/leaderboard/${addressPath}`, { replace: true });
    }
  }, [addressPath, isLegacyProofsPath]);

  const RoutePage =
    pathname.startsWith("/leaderboard") || addressPath
      ? LazyLeaderboardPage
      : pathname.startsWith("/tx/")
        ? LazyTxPage
        : pathname === "/runs" || isLegacyProofsPath
          ? LazyRunsPage
          : pathname === "/wallet"
            ? LazyWalletPage
            : LazyGamePage;

  return (
    <WalletProvider>
      <SiteHeader />
      <NetworkChangeNotice />
      <ErrorBoundary key={pathname}>
        <Suspense fallback={routeFallback}>
          <RoutePage />
        </Suspense>
      </ErrorBoundary>
      <SiteFooter />
    </WalletProvider>
  );
}

export default App;
