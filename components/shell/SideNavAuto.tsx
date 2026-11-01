"use client";
// SideNav for the platform layout: a server layout cannot see the URL, so this reads it (usePathname) and marks the
// area that contains it with aria-current="page". It renders on the server too, so the attribute is in the first HTML.
// Props are plain data: the layout localises labels with the server translator (sideNavListItems).
import { usePathname } from "next/navigation";
import { currentArea, SideNavList, type SideNavListProps } from "./SideNav";

export function SideNavAuto(props: Omit<SideNavListProps, "current">) {
  const pathname = usePathname() ?? "";
  return <SideNavList {...props} current={currentArea(pathname, props.items)} />;
}
