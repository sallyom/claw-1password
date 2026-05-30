import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "1password",
  name: "1Password",
  description: "1Password SecretRef provider integration",
  register() {
    // Secret provider integration is declared in openclaw.plugin.json.
  },
});
