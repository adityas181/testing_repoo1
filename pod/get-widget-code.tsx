import { customGetHostProtocol } from "@/customization/utils/custom-get-host-protocol";
import type { GetCodeType } from "@/types/tweaks";

const ENV_NAME_TO_NUM: Record<string, string> = {
  dev: "0",
  uat: "1",
  prod: "2",
};

function toEnvNum(env: string): string {
  return ENV_NAME_TO_NUM[env] ?? env;
}

/**
 * Function to get the widget code for the API
 * @param {string} agent - The current agent.
 * @returns {string} - The widget code
 */
export default function getWidgetCode({
  agentId,
  agentName,
  env = "dev",
  version = "v1",
  isAuth: _isAuth,
  copy = false,
}: GetCodeType): string {
  const { protocol, host } = customGetHostProtocol();
  const envNum = toEnvNum(env);

  const source = copy
    ? `<script
  src="${protocol}//${host}/widget/agentcore-chat.js">
</script>`
    : `<script
  src="${protocol}//${host}/widget/agentcore-chat.js">
</script>`;

  return `${source}
  <agentcore-chat
    window_title="${agentName}"
    agent_id="${agentId}"
    env="${envNum}"
    version="${version}"
    host_url="${protocol}//${host}"
    api_key="YOUR_AGENTCORE_API_KEY">
</agentcore-chat>`;
}
