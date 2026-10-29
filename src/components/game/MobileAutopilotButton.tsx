import Bot from "lucide-react/dist/esm/icons/bot";
import { Button } from "@/components/ui/button";

interface MobileAutopilotButtonProps {
  active: boolean;
  onToggle: () => void;
  endlessEnabled?: boolean;
  onToggleEndless?: () => void;
}

export function MobileAutopilotButton({
  active,
  onToggle,
  endlessEnabled = false,
  onToggleEndless,
}: MobileAutopilotButtonProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:hidden">
      <Button
        variant={active ? "active" : "space"}
        size="default"
        className="gap-2 px-4"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        aria-label={active ? "Disable autopilot" : "Enable autopilot"}
      >
        <Bot className="size-4" />
        <span className="text-[0.72rem]">{active ? "AUTO ON" : "AUTO OFF"}</span>
      </Button>

      <Button
        type="button"
        variant={endlessEnabled ? "active" : "space"}
        size="default"
        className="px-4"
        onClick={(e) => {
          e.stopPropagation();
          onToggleEndless?.();
        }}
        aria-label={endlessEnabled ? "Disable endless mode" : "Enable endless mode"}
      >
        <span className="text-[0.72rem]">{endlessEnabled ? "ENDLESS ON" : "ENDLESS OFF"}</span>
      </Button>
    </div>
  );
}
