import { ArrowLeft, Cog, Monitor, Moon, Sun, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FrameTitle } from "@/components/ui/frame";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { useAppTheme } from "@/lib/app-theme";
import { isThemePreference } from "@/lib/theme";

export function SidebarFrameHeader({
  onBack,
  onResetLocalData,
  title,
}: {
  onBack?: () => void;
  onResetLocalData: () => void;
  title: string;
}) {
  const theme = useAppTheme();

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
        <MenuPopup align="end" className="w-48">
          <MenuGroup>
            <MenuGroupLabel>Appearance</MenuGroupLabel>
            <MenuRadioGroup
              value={theme.preference}
              onValueChange={(value) => {
                if (isThemePreference(value)) {
                  theme.setPreference(value);
                }
              }}
            >
              <MenuRadioItem className="cursor-pointer" value="system">
                <Monitor className="size-4" />
                System
              </MenuRadioItem>
              <MenuRadioItem className="cursor-pointer" value="light">
                <Sun className="size-4" />
                Light
              </MenuRadioItem>
              <MenuRadioItem className="cursor-pointer" value="dark">
                <Moon className="size-4" />
                Dark
              </MenuRadioItem>
            </MenuRadioGroup>
          </MenuGroup>
          <MenuSeparator />
          <MenuGroup>
            <MenuItem
              variant="destructive"
              className="cursor-pointer whitespace-nowrap"
              onClick={onResetLocalData}
            >
              <Trash2 className="size-4" />
              Reset local data
            </MenuItem>
          </MenuGroup>
        </MenuPopup>
      </Menu>
    </header>
  );
}
