import { createRoot } from "react-dom/client";
import { SupportChat } from "./SupportChat";

// Open index.html?tenant=tnt_xxx&project=proj_xxx after bundling this file (see README.md). Only the ids are needed: they are public.
// In your app you do not need this file: render <SupportChat /> where your app wants the chat (a client component: it uses the browser).
const params = new URLSearchParams(location.search);
createRoot(document.getElementById("root")!).render(<SupportChat tenantId={params.get("tenant") ?? ""} projectId={params.get("project") ?? ""} backendUrl={params.get("backend") ?? undefined} />);
