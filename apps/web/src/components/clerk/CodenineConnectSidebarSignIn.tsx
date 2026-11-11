import { UserButton, useAuth } from "@clerk/react";
import { LogInIcon } from "lucide-react";

import { hasCloudPublicConfig } from "../../cloud/publicConfig";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { CODENINE_CONNECT_ACCOUNT_PAGES } from "./CodenineConnectAccountPages";
import { useCodenineConnectAuthPrompt } from "./useCodenineConnectAuthPrompt";

export function CodenineConnectSidebarSignIn() {
  if (!hasCloudPublicConfig()) return null;

  return <ConfiguredCodenineConnectSidebarSignIn />;
}

export function CodenineConnectSidebarAvatar() {
  if (!hasCloudPublicConfig()) return null;

  return <ConfiguredCodenineConnectSidebarAvatar />;
}

function ConfiguredCodenineConnectSidebarAvatar() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded || !isSignedIn) return null;

  return (
    <UserButton
      appearance={{
        elements: {
          avatarBox: "size-7",
          // Clerk's unlayered trigger reset (padding, radius, background) beats layered utilities.
          userButtonTrigger: "mb-1! rounded-lg! p-1! hover:bg-sidebar-row-hover!",
        },
      }}
    >
      {CODENINE_CONNECT_ACCOUNT_PAGES.map((page) => (
        <UserButton.UserProfilePage
          key={page.url}
          label={page.label}
          labelIcon={page.icon}
          url={page.url}
        >
          {page.content}
        </UserButton.UserProfilePage>
      ))}
    </UserButton>
  );
}

function ConfiguredCodenineConnectSidebarSignIn() {
  const { isLoaded, isSignedIn } = useAuth();
  const { openAuthPrompt } = useCodenineConnectAuthPrompt();

  if (!isLoaded || isSignedIn) return null;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton onClick={openAuthPrompt}>
          <LogInIcon />
          <span>Sign in to Codenine Connect</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
