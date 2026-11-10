import { createSupportChat } from "@supcoflow/chat/core";
import { mountCustomChat } from "./ui";

// Open index.html?tenant=tnt_xxx&project=proj_xxx after bundling this file (see README.md). Only the ids are needed: they are public.
const params = new URLSearchParams(location.search);
const chat = createSupportChat({ tenantId: params.get("tenant") ?? "", projectId: params.get("project") ?? "", backendUrl: params.get("backend") ?? undefined });

// Is the chat active for this origin? If not, show nothing — the same thing the widget does.
void chat.checkAvailability().then(({ available, reason }) => {
  const root = document.getElementById("chat")!;
  if (available) mountCustomChat(root, chat);
  else console.warn("[supcoflow] the chat is not available here:", reason);
});
