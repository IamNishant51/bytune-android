/**
 * MobileActionSheet — the context menu for touch.
 *
 * Desktop rows call `useUI.openContextMenu(...)` from a right-click; the popup
 * ContextMenu component renders it beside the pointer. Nothing on a phone
 * right-clicks, yet every row owns the same items — so on Android the same
 * state renders as a bottom sheet (the MobileSheet container, previously
 * never rendered): the long-press hook synthesizes the same contextmenu
 * event on a hold, and any "more" button opens the sheet directly.
 *
 * Submenus (Add to playlist → its playlists) expand inline instead of
 * flying out from a hover anchor. Position/align options are ignored — a
 * sheet always docks at the bottom.
 */
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { MobileSheet } from "./MobileShell";
import { useUI, type MenuItem } from "../stores/ui";

function SheetRow({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const Icon = item.icon;
  return (
    <button
      disabled={item.disabled}
      onClick={(e) => {
        e.stopPropagation();
        item.action?.();
        onClose();
      }}
      className={`w-full flex items-center gap-3 px-4 py-3 text-[14px] text-left active:bg-white/[0.08] transition-colors disabled:opacity-40 ${
        item.danger ? "text-red-400" : "text-white/90 active:text-white"
      }`}
    >
      {Icon && <Icon className={`w-[18px] h-[18px] shrink-0 opacity-80`} />}
      <span className="truncate font-medium">{item.label}</span>
    </button>
  );
}

/** Renders one flat slot; a `children` item expands in place (a hover flyout
 *  has no anchor on a sheet). */
function renderRows(items: MenuItem[], openSub: number | null, setOpenSub: (n: number | null) => void, onClose: () => void): ReactNode[] {
  return items.map((item, i) => {
    if (item.header) {
      return (
        <Fragment key={`h-${i}`}>
          {item.separatorBefore && <div className="my-1.5 h-px bg-white/[0.07]" />}
          <div className="px-4 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white/45">
            {item.label}
          </div>
        </Fragment>
      );
    }
    const hasSub = !!item.children && item.children.length > 0;
    const subOpen = hasSub && openSub === i;
    return (
      <Fragment key={`${item.label}-${i}`}>
        {item.separatorBefore && <div className="my-1.5 h-px bg-white/[0.07]" />}
        {hasSub ? (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setOpenSub(subOpen ? null : i);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-[14px] text-left text-white/90 active:bg-white/[0.08]"
            >
              {item.icon && <item.icon className="w-[18px] h-[18px] shrink-0 opacity-80" />}
              <span className="truncate font-medium">{item.label}</span>
              <ChevronRight className={`ml-auto w-4 h-4 opacity-60 transition-transform ${subOpen ? "rotate-90" : ""}`} />
            </button>
            {subOpen && (
              <div className="pl-4 bg-white/[0.04]">
                {item.children!.map((child, ci) => (
                  <SheetRow key={`${item.label}-${ci}`} item={child} onClose={onClose} />
                ))}
              </div>
            )}
          </>
        ) : (
          <SheetRow item={item} onClose={onClose} />
        )}
      </Fragment>
    );
  });
}

export function MobileActionSheet() {
  const menu = useUI((s) => s.contextMenu);
  const close = useUI((s) => s.closeContextMenu);
  const [openSub, setOpenSub] = useState<number | null>(null);
  // A freshly opened sheet always starts with every submenu folded.
  useEffect(() => setOpenSub(null), [menu]);

  if (!menu) return null;

  return (
    <MobileSheet onClose={close}>
      <div className="pt-2.5 pb-1 flex justify-center">
        <span className="block h-1 w-10 rounded-full bg-white/20" aria-hidden />
      </div>
      <div className="p-1.5 pb-4" role="menu" aria-label="Actions">
        {renderRows(menu.items, openSub, setOpenSub, close)}
      </div>
    </MobileSheet>
  );
}
