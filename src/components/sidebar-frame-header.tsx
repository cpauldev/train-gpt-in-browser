import { ArrowLeft, Cog, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FrameTitle } from "@/components/ui/frame";
import { Menu, MenuGroup, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";

export function SidebarFrameHeader({
  onBack,
  onResetLocalData,
  title,
}: {
  onBack?: () => void;
  onResetLocalData: () => void;
  title: string;
}) {
  return (
    <header className="flex min-h-16 items-center gap-3 px-5 py-4" data-slot="frame-panel-header">
      {onBack ? (
        <Button variant="outline" size="xs" className="gap-1.5" onClick={onBack}>
          <ArrowLeft className="size-3.5" />
          Back
        </Button>
      ) : null}

      <FrameTitle className="min-w-0 flex-1 truncate text-base sm:text-sm">{title}</FrameTitle>

      <Menu>
        <MenuTrigger
          render={
            <Button variant="outline" size="icon-xs" className="ml-auto" aria-label="Settings">
              <Cog className="size-4" />
            </Button>
          }
        />
        <MenuPopup align="end">
          <MenuGroup>
            <MenuItem variant="destructive" className="cursor-pointer" onClick={onResetLocalData}>
              <Trash2 className="size-4" />
              Reset local data
            </MenuItem>
          </MenuGroup>
        </MenuPopup>
      </Menu>
    </header>
  );
}
