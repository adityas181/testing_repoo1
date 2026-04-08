import { useEffect, useMemo, useState } from "react";
import { useCustomNavigate } from "@/customization/hooks/use-custom-navigate";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePostAddAgent } from "@/controllers/API/queries/agents/use-post-add-agent";
import useDeleteAgent from "@/hooks/agents/use-delete-agent";
import BaseModal from "@/modals/baseModal";
import useAlertStore from "@/stores/alertStore";
import useAgentsManagerStore from "@/stores/agentsManagerStore";
import { useFolderStore } from "@/stores/foldersStore";
import type { AgentType } from "@/types/agent";
import { createNewAgent } from "@/utils/reactFlowUtils";

type TransferMode = "move" | "copy";

type AgentTransferModalProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  mode: TransferMode;
  agent: AgentType;
  currentProjectId?: string;
  deploymentWarning?: boolean;
};

const AgentTransferModal = ({
  open,
  setOpen,
  mode,
  agent,
  currentProjectId,
  deploymentWarning = false,
}: AgentTransferModalProps) => {
  const navigate = useCustomNavigate();
  const folders = useFolderStore((state) => state.folders);
  const { mutateAsync: postAddAgent } = usePostAddAgent();
  const { deleteAgent } = useDeleteAgent();
  const setSuccessData = useAlertStore((state) => state.setSuccessData);
  const setErrorData = useAlertStore((state) => state.setErrorData);
  const setAgents = useAgentsManagerStore((state) => state.setAgents);
  const queryClient = useQueryClient();
  const [targetProjectId, setTargetProjectId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableProjects = useMemo(() => {
    const list = folders || [];
    if (!currentProjectId) {
      return list;
    }
    return list.filter((folder) => folder.id !== currentProjectId);
  }, [folders, currentProjectId]);

  const warningTitle =
    mode === "move" ? "Moving will create a new agent" : "Copy creates a new agent";
  const warningDescription =
    mode === "move"
      ? "This creates a new agent in the selected project and removes the original. The new agent will have a new agent ID and project ID. Links, runs, and references will point to the new IDs."
      : "This creates a new agent in the selected project. The copied agent will have a new agent ID and project ID. The original agent stays in its current project.";
  const deploymentDescription =
    deploymentWarning && mode === "copy"
      ? "This agent has a UAT/PROD version, so moving is disabled. Copying creates a new agent without affecting the deployed version."
      : "";

  useEffect(() => {
    if (open) {
      setTargetProjectId("");
      setIsSubmitting(false);
    }
  }, [open, mode, agent.id]);

  const handleSubmit = async () => {
    if (!agent?.data) {
      setErrorData({
        title: "Unable to transfer agent",
        list: ["Agent data is unavailable. Please refresh and try again."],
      });
      return;
    }

    if (!targetProjectId) {
      setErrorData({
        title: "Select a target project",
        list: ["Choose a project before continuing."],
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const newAgent = createNewAgent(agent.data, targetProjectId, agent);
      const createdAgent = await postAddAgent(newAgent);

      if (mode === "move") {
        await deleteAgent({ id: agent.id });
      }

      if (createdAgent?.id) {
        const currentAgents = useAgentsManagerStore.getState().agents ?? [];
        if (!currentAgents.some((item) => item.id === createdAgent.id)) {
          setAgents([...currentAgents, createdAgent]);
        }
      }

      queryClient.invalidateQueries({
        queryKey: ["useGetFolder", targetProjectId],
      });

      if (currentProjectId) {
        queryClient.invalidateQueries({
          queryKey: ["useGetFolder", currentProjectId],
        });
      }

      setSuccessData({
        title:
          mode === "move"
            ? "Agent moved to the selected project"
            : "Agent copied to the selected project",
      });
      setOpen(false);
    } catch (error) {
      console.error(error);
      setErrorData({
        title:
          mode === "move" ? "Failed to move agent" : "Failed to copy agent",
        list: ["Please try again."],
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <BaseModal open={open} setOpen={setOpen} size="small-query">
      <BaseModal.Header
        description={
          mode === "move"
            ? "Move this agent to a different project."
            : "Copy this agent into another project."
        }
      >
        {mode === "move" ? "Move Agent" : "Copy Agent"}
      </BaseModal.Header>
      <BaseModal.Content className="flex flex-col gap-4 p-4">
        <Alert className="border-yellow-200 bg-yellow-50 text-yellow-900">
          <AlertTitle>{warningTitle}</AlertTitle>
          <AlertDescription>
            <p>{warningDescription}</p>
            {deploymentDescription && (
              <p className="mt-2">{deploymentDescription}</p>
            )}
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <Label htmlFor="transfer-project">Target project</Label>
          <Select
            value={targetProjectId}
            onValueChange={(value) => {
              if (value === "__create__") {
                setOpen(false);
                navigate("/agents?openCreateProject=1");
                return;
              }
              setTargetProjectId(value);
            }}
          >
            <SelectTrigger id="transfer-project">
              <SelectValue placeholder="Select a project" />
            </SelectTrigger>
            <SelectContent className="max-h-72 overflow-y-auto">
              <SelectItem value="__create__">Create new project...</SelectItem>
              {availableProjects.length === 0 ? (
                <SelectItem value="__none__" disabled>
                  No other projects available
                </SelectItem>
              ) : (
                availableProjects.map((folder) => (
                  <SelectItem key={folder.id} value={folder.id}>
                    {folder.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
      </BaseModal.Content>
      <BaseModal.Footer
        submit={{
          label: mode === "move" ? "Move Agent" : "Copy Agent",
          onClick: handleSubmit,
          loading: isSubmitting,
          disabled: isSubmitting || availableProjects.length === 0 || !targetProjectId,
          dataTestId: mode === "move" ? "btn-move-agent" : "btn-copy-agent",
        }}
      />
    </BaseModal>
  );
};

export default AgentTransferModal;
