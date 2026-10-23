import Edit3 from "lucide-react/dist/esm/icons/edit-3";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorMessage } from "@/components/shared/ErrorMessage";
import { RelativeTime } from "./RelativeTime";

export interface EditProfileProps {
  username: string;
  linkUrl: string;
  onUsernameChange: (v: string) => void;
  onLinkUrlChange: (v: string) => void;
  onSave: () => void;
  isSaving: boolean;
  saveError: string | null;
  savedAt: string | null;
}

export function EditProfile({
  username,
  linkUrl,
  onUsernameChange,
  onLinkUrlChange,
  onSave,
  isSaving,
  saveError,
  savedAt,
}: EditProfileProps) {
  return (
    <Card>
      <h3 className="m-0 flex items-center gap-2 font-display tracking-[0.055em] uppercase">
        <Edit3 className="size-4 text-primary" />
        Edit Profile
      </h3>
      <p className="m-0 text-sm text-text-soft">
        Your player key in this browser signs the change. No prompt is needed.
      </p>
      <div className="grid gap-2.5">
        <label className="grid gap-1.5 text-xs uppercase tracking-[0.04em]">
          Username
          <Input
            type="text"
            value={username}
            onChange={(event) => onUsernameChange(event.target.value)}
            placeholder="Your leaderboard name"
            maxLength={32}
          />
        </label>
        <label className="grid gap-1.5 text-xs uppercase tracking-[0.04em]">
          Link URL
          <Input
            type="url"
            value={linkUrl}
            onChange={(event) => onLinkUrlChange(event.target.value)}
            placeholder="https://"
            maxLength={240}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Profile"}
        </Button>
        {savedAt ? (
          <span className="text-sm text-text-soft">
            Saved <RelativeTime value={savedAt} />
          </span>
        ) : null}
      </div>
      <ErrorMessage message={saveError} />
    </Card>
  );
}
