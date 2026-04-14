import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Send, Sparkles, ChevronDown, Plus, MessageSquare, PanelLeftClose, PanelLeft, User, Loader2, Trash2, Check, ImagePlus, X, Clock, Search, Image, Archive, ChevronRight, Globe, BookOpen, Headphones, Info, HelpCircle, Mic, AudioLines, FileUp, Paintbrush, Lightbulb, Upload, MoreVertical, Folder, ArrowLeft, File, FileText, Shield, CheckCircle2, SquarePen, Mail, Download, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useGetOrchAgents,
  useGetOrchSessions,
  useGetOrchMessages,
  useDeleteOrchSession,
} from "@/controllers/API/queries/orchestrator";
import type {
  OrchAgentSummary,
  OrchSessionSummary,
  OrchMessageResponse,
} from "@/controllers/API/queries/orchestrator";
import { usePostUploadFileV2 } from "@/controllers/API/queries/file-management/use-post-upload-file";
import { useGetFilesV2 } from "@/controllers/API/queries/file-management/use-get-files";
import { api, performStreamingRequest } from "@/controllers/API/api";
import { getURL } from "@/controllers/API/helpers/constants";
import { BASE_URL_API } from "@/constants/constants";
import { AuthContext } from "@/contexts/authContext";
import { MarkdownField } from "@/modals/IOModal/components/chatView/chatMessage/components/edit-message";
import { ContentBlockDisplay } from "@/components/core/chatComponents/ContentBlockDisplay";
import type { ContentBlock } from "@/types/chat";
import SharePointFilePicker from "./SharePointFilePicker";
import OutlookConnector, { useOutlookStatus } from "./OutlookConnector";
import NotebookLMPanel from "./NotebookLMPanel";
import useAlertStore from "@/stores/alertStore";
import openaiLogo from "@/assets/openai_logo.svg";
import geminiLogo from "@/assets/gemini_logo.svg";
import mistralLogo from "@/assets/mistral_logo.svg";
import claudeLogo from "@/assets/claude_logo.svg";
import azureLogo from "@/assets/azure_logo.svg";
import metaLogo from "@/assets/meta_logo.svg";
import cohereLogo from "@/assets/cohere_logo.svg";
import perplexityLogo from "@/assets/perplexity_logo.svg";
import nvidiaLogo from "@/assets/nvidia_logo.svg";
import huggingfaceLogo from "@/assets/huggingface_logo.svg";
import micoreLogo from "@/assets/micore.svg";
import grokLogo from "@/assets/grok_logo.png";
import nanoBananaLogo from "@/assets/nano_banana_logo.png";
import dalleLogo from "@/assets/dalle_logo.svg";
import googleLogo from "@/assets/google_logo.svg";
import defaultLlmLogo from "@/assets/default_llm_logo.png";
import notebookLMLogo from "@/assets/notebooklm_logo.svg";
import translatorLogo from "@/assets/translator_logo.png";
import imageLibraryLogo from "@/assets/image_library_logo.svg";
import miNewChatIcon from "@/assets/mibuddy_new_chat.svg";
import miSearchIcon from "@/assets/mibuddy_search.svg";
import miChatHistoryIcon from "@/assets/mibuddy_chat_history.svg";
import miArchiveIcon from "@/assets/mibuddy_archive.svg";
import miInformationIcon from "@/assets/mibuddy_information.svg";
import miHelpIcon from "@/assets/mibuddy_help.svg";

// Sidebar mono icon: renders an SVG via CSS mask so it inherits the parent's text color.
function SidebarMaskIcon({ src, className = "h-4 w-4 shrink-0 bg-muted-foreground" }: { src: string; className?: string }) {
  return (
    <span
      className={className}
      style={{
        maskImage: `url(${src})`,
        WebkitMaskImage: `url(${src})`,
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  );
}

/* ------------------ TYPES ------------------ */

interface Agent {
  id: string;
  name: string;
  description: string;
  online: boolean;
  color: string;
  deploy_id: string;
  agent_id: string;
  version_number: number;
  version_label: string;
  environment: "uat" | "prod" | string;
}

interface Message {
  id: string;
  sender: "user" | "agent" | "system";
  agentName?: string;
  content: string;
  timestamp: string;
  category?: string;
  contentBlocks?: ContentBlock[];
  blocksState?: string;
  files?: string[];
  reasoningContent?: string;
  // HITL (Human-in-the-Loop) approval fields
  hitl?: boolean;
  hitlActions?: string[];
  hitlThreadId?: string;
  hitlIsDeployed?: boolean;
}

interface FilePreview {
  id: string;
  file: File;
  path?: string;
  loading: boolean;
  error: boolean;
}

/* ------------------ COLOR PALETTE ------------------ */

const AGENT_COLORS = [
  "#10a37f", "#ab68ff", "#19c37d", "#ef4146", "#f5a623", "#0ea5e9",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
];

/* ------------------ HELPERS ------------------ */

function mapApiAgents(apiAgents: OrchAgentSummary[]): Agent[] {
  return apiAgents.map((a, i) => ({
    id: a.deploy_id,
    name: a.agent_name,
    description: a.agent_description || "",
    online: true,
    color: AGENT_COLORS[i % AGENT_COLORS.length],
    deploy_id: a.deploy_id,
    agent_id: a.agent_id,
    version_number: a.version_number,
    version_label: a.version_label,
    environment: a.environment,
  }));
}

function inferHitlFromText(text: string): boolean {
  if (!text) return false;
  const normalized = text.toLowerCase();
  return (
    normalized.includes("waiting for human review") &&
    normalized.includes("available actions")
  );
}

function extractHitlActions(text: string): string[] {
  if (!text) return [];
  const out = new Set<string>();

  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^[\s>*•-]*([A-Za-z][A-Za-z ]*[A-Za-z])\s*$/);
    if (!m?.[1]) continue;
    const action = m[1].trim();
    if (/approve|reject|edit|cancel/i.test(action)) {
      out.add(action);
    }
  }

  // Fallback for inline formats like "Available actions: • Approve • Reject"
  if (out.size === 0) {
    const inline = text.match(/approve|reject|edit|cancel/gi) ?? [];
    for (const action of inline) {
      out.add(action.charAt(0).toUpperCase() + action.slice(1).toLowerCase());
    }
  }

  return Array.from(out);
}

function mapApiMessages(apiMessages: OrchMessageResponse[]): Message[] {
  return apiMessages.map((m) => {
    const props = (m.properties || {}) as Record<string, any>;
    const isHitl = !!props.hitl || inferHitlFromText(m.text || "");
    const parsedActions = Array.isArray(props.actions)
      ? props.actions
      : extractHitlActions(m.text || "");

    // Restore content_blocks (reasoning / tool-use steps) from persisted data.
    // During streaming these arrive via SSE; on reload they come from the API.
    const toolBlocks = (m.content_blocks ?? []).filter((block: any) =>
      block.contents?.some((c: any) => c.type === "tool_use"),
    );

    return {
      id: m.id,
      sender: m.sender as "user" | "agent" | "system",
      agentName: m.sender === "agent" ? m.sender_name : undefined,
      content: m.text,
      timestamp: m.timestamp
        ? new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "",
      category: m.category || "message",
      files: m.files && m.files.length > 0 ? m.files : undefined,
      contentBlocks: toolBlocks.length > 0 ? toolBlocks : undefined,
      blocksState: toolBlocks.length > 0 ? "complete" : undefined,
      // Restore HITL metadata from persisted properties.
      // Fallback to text inference because some interrupted rows may miss fields.
      hitl: isHitl,
      hitlActions: isHitl ? parsedActions : undefined,
      hitlThreadId: isHitl ? (props.thread_id ?? m.session_id ?? "") : undefined,
      // Orchestrator chat runs deployed agents; default true when missing.
      hitlIsDeployed: isHitl
        ? (props.is_deployed_run !== undefined ? !!props.is_deployed_run : true)
        : undefined,
      reasoningContent: (m as any).reasoning_content || undefined,
    };
  });
}

function hitlStatusLabel(value: string): string {
  const normalized = (value || "").toLowerCase();
  if (normalized.includes("reject")) return "Rejected";
  if (normalized.includes("approve")) return "Approved";
  if (normalized.includes("edit")) return "Edited";
  if (normalized.includes("cancel")) return "Cancelled";
  if (normalized.includes("timeout")) return "Timed out";
  return "Resolved";
}

function groupSessionsByDate(
  sessions: OrchSessionSummary[],
  getLabel: (key: string) => string,
): Record<string, OrchSessionSummary[]> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const groups: Record<string, OrchSessionSummary[]> = {};

  for (const s of sessions) {
    const ts = s.last_timestamp ? new Date(s.last_timestamp) : new Date(0);
    let label: string;
    if (ts >= today) label = getLabel("Today");
    else if (ts >= yesterday) label = getLabel("Yesterday");
    else if (ts >= weekAgo) label = getLabel("Previous 7 Days");
    else label = getLabel("Older");

    if (!groups[label]) groups[label] = [];
    groups[label].push(s);
  }
  return groups;
}

/* ------------------ AI MODEL OPTIONS (Addon) ------------------ */

interface AiModelOption {
  id: string;
  name: string;
  icon: string;        // image path (svg/png) for the model
  group: "main" | "more";
  capabilities?: Record<string, any>;
  is_default?: boolean;
}

// Resolve a model logo by matching id/name/provider against known patterns.
function resolveModelIcon(model: { model_id?: string; model_name?: string; display_name?: string; provider?: string }): string {
  const hay = `${model.model_id || ""} ${model.model_name || ""} ${model.display_name || ""}`.toLowerCase();
  const provider = (model.provider || "").toLowerCase();

  if (/mibuddy|mi[\s_-]?core|micore/.test(hay)) return micoreLogo;
  if (/dall[\s_-]?e/.test(hay)) return dalleLogo;
  if (/grok/.test(hay)) return grokLogo;
  if (/nano[\s_-]?banana/.test(hay)) return nanoBananaLogo;
  if (/web[\s_-]?search|google[\s_-]?search/.test(hay)) return googleLogo;
  if (/gemini|bard|palm/.test(hay)) return geminiLogo;
  if (/mistral|mixtral/.test(hay)) return mistralLogo;
  if (/claude|anthropic/.test(hay)) return claudeLogo;
  if (/llama|meta/.test(hay)) return metaLogo;
  if (/cohere|command[\s_-]?r/.test(hay)) return cohereLogo;
  if (/perplexity|sonar/.test(hay)) return perplexityLogo;
  if (/nvidia|nemotron/.test(hay)) return nvidiaLogo;
  if (/hugging[\s_-]?face/.test(hay)) return huggingfaceLogo;
  if (/gpt|openai|o1|o3|o4/.test(hay)) return openaiLogo;
  if (/azure/.test(hay)) return azureLogo;

  // Provider fallbacks
  if (provider === "openai" || provider === "openai_compatible") return openaiLogo;
  if (provider === "azure") return azureLogo;
  if (provider === "anthropic") return claudeLogo;
  if (provider === "google" || provider === "google_vertex") return geminiLogo;
  return defaultLlmLogo;
}


// Empty default — models are fetched from API on mount
const FALLBACK_AI_MODELS: AiModelOption[] = [];

/* ------------------ IMAGE GALLERY VIEW ------------------ */

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];

function ImageGalleryView({
  onBack,
  selectedImage,
  onSelectImage,
  onClosePreview,
}: {
  onBack: () => void;
  selectedImage: { src: string; name: string } | null;
  onSelectImage: (img: { src: string; name: string }) => void;
  onClosePreview: () => void;
}) {
  const { t } = useTranslation();
  const [images, setGalleryImages] = useState<{ id: string; name: string; src: string; createdAt: string }[]>([]);
  const [isLoading, setGalleryLoading] = useState(true);

  // Fetch AI-generated images from MiBuddy dedicated endpoint
  useEffect(() => {
    const tokenMatch = document.cookie.match(/(?:^|;\s*)access_token_lf=([^;]*)/);
    const headers: Record<string, string> = {};
    if (tokenMatch?.[1]) headers["Authorization"] = `Bearer ${decodeURIComponent(tokenMatch[1])}`;

    fetch(`${getURL("ORCHESTRATOR")}/generated-images`, { headers, credentials: "include" })
      .then((res) => res.json())
      .then((data: any[]) => {
        setGalleryImages(
          (data || []).map((img: any, idx: number) => ({
            id: `gen-${idx}`,
            name: img.name || "AI Generated Image",
            src: img.src,
            createdAt: "",
          })),
        );
      })
      .catch((err) => console.warn("Failed to load generated images:", err))
      .finally(() => setGalleryLoading(false));
  }, []);

  const handleDownload = async (src: string, name: string) => {
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name || `image-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(src, "_blank");
    }
  };

  return (
    <div className="relative flex flex-1 flex-col">
      {/* Header */}
      <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border px-4">
        <button
          onClick={onBack}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft size={18} />
        </button>
        <Image size={20} className="text-primary" />
        <h2 className="text-base font-semibold text-foreground">{t("My Images")}</h2>
        <span className="ml-auto text-xs text-muted-foreground">
          {images.length > 0 ? `${images.length} ${t("most recent")}` : ""}
        </span>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 size={32} className="animate-spin text-muted-foreground" />
          </div>
        ) : images.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
            <Image size={48} className="opacity-30" />
            <p className="text-lg">{t("No images available")}</p>
            <p className="text-sm">{t("Images generated by agents will appear here")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {images.map((img) => (
              <div
                key={img.id}
                className="group relative cursor-pointer overflow-hidden rounded-xl border border-border bg-muted/30 transition-shadow hover:shadow-lg hover:border-primary/50"
                onClick={() => onSelectImage({ src: img.src, name: img.name })}
              >
                <div className="aspect-square overflow-hidden">
                  <img
                    src={img.src}
                    alt={img.name}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    loading="lazy"
                  />
                </div>
                <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100">
                  <div className="flex items-center justify-between p-3">
                    <span className="max-w-[70%] truncate text-xs font-medium text-white">{img.name}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDownload(img.src, img.name); }}
                      className="rounded-full bg-white/20 p-1.5 text-white backdrop-blur-sm hover:bg-white/40"
                    >
                      <Download size={14} />
                    </button>
                  </div>
                </div>
                {img.createdAt && (
                  <div className="absolute right-2 top-2 rounded-md bg-black/40 px-1.5 py-0.5 text-xxs text-white opacity-0 backdrop-blur-sm group-hover:opacity-100">
                    {new Date(img.createdAt).toLocaleDateString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {selectedImage && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80" onClick={onClosePreview}>
          <div className="relative flex max-h-[90vh] max-w-[90vw] flex-col items-center" onClick={(e) => e.stopPropagation()}>
            <button onClick={onClosePreview} className="absolute -right-3 -top-3 z-10 rounded-full bg-zinc-800 p-2 text-white shadow-lg hover:bg-zinc-700">
              <X size={18} />
            </button>
            <img src={selectedImage.src} alt={selectedImage.name} className="max-h-[80vh] max-w-[85vw] rounded-lg object-contain" />
            <div className="mt-4 flex items-center gap-4">
              <span className="max-w-xs truncate text-sm text-white/80">{selectedImage.name}</span>
              <button onClick={() => handleDownload(selectedImage.src, selectedImage.name)} className="flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm text-white backdrop-blur-sm hover:bg-white/20">
                <Download size={16} />
                {t("Download")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------ COMPONENT ------------------ */

export default function AgentOrchestrator() {
  const { t } = useTranslation();
  const { permissions } = useContext(AuthContext);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [showMentions, setShowMentions] = useState(false);
  const [filteredAgents, setFilteredAgents] = useState<Agent[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string>(crypto.randomUUID());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [streamingAgentName, setStreamingAgentName] = useState<string>("");
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  // HITL state: track which message had its action clicked
  const [hitlDoneMap, setHitlDoneMap] = useState<Record<string, string>>({});
  const [hitlLoadingId, setHitlLoadingId] = useState<string | null>(null);
  const [hitlLoadingAction, setHitlLoadingAction] = useState<string | null>(null);
  const [uploadFiles, setUploadFiles] = useState<FilePreview[]>([]);
  // Addon UI state
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [plusMenuPos, setPlusMenuPos] = useState<{ bottom: number; left: number }>({ bottom: 0, left: 0 });
  const [cotReasoning, setCotReasoning] = useState(false);
  const [showChatHistoryExpand, setShowChatHistoryExpand] = useState(false);
  const [showArchiveChatExpand, setShowArchiveChatExpand] = useState(false);
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState("");
  const [showSearchInput, setShowSearchInput] = useState(false);
  const [chatMenuOpenId, setChatMenuOpenId] = useState<string | null>(null);
  const [chatMenuPos, setChatMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  // Addon: AI Model selector state
  const [showAiModelPicker, setShowAiModelPicker] = useState(false);
  const [showMoreModels, setShowMoreModels] = useState(false);
  const [selectedAiModel, setSelectedAiModel] = useState<string | null>(null);
  const [aiModels, setAiModels] = useState<AiModelOption[]>(FALLBACK_AI_MODELS);
  const [noAgentMode, setNoAgentMode] = useState(false);
  // Addon: SharePoint file picker
  const [spPickerOpen, setSpPickerOpen] = useState(false);
  // Addon: Image gallery view (replaces chat area when active)
  const [showImageGallery, setShowImageGallery] = useState(false);
  const [showNotebookLM, setShowNotebookLM] = useState(false);
  const [selectedGalleryImage, setSelectedGalleryImage] = useState<{ src: string; name: string } | null>(null);
  // Addon: Canvas mode
  const [isCanvasEnabled, setIsCanvasEnabled] = useState(false);
  // Addon: Image generation mode (sticky chip — stays until user clicks ×)
  const [imageMode, setImageMode] = useState(false);
  // Addon: Per-message export menu (msg.id) and copy feedback
  const [exportMenuOpenId, setExportMenuOpenId] = useState<string | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [canvasEditingId, setCanvasEditingId] = useState<string | null>(null);
  const [canvasEditTexts, setCanvasEditTexts] = useState<Record<string, string>>({});
  // Addon: Autocomplete suggestions
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIdx, setSelectedSuggestionIdx] = useState(-1);
  const suggestionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Addon: Speech-to-Text (mic)
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  // Addon: Outlook connector
  const [outlookDialogOpen, setOutlookDialogOpen] = useState(false);
  const { isConnected: isOutlookConnected, refresh: refreshOutlookStatus, setIsConnected: setOutlookConnected } = useOutlookStatus();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const aiModelPickerRef = useRef<HTMLDivElement>(null);
  const hitlSessionRef = useRef<string | null>(null);

  /* ------------------ FILE UPLOAD ------------------ */

  const { mutate: uploadFileMutate } = usePostUploadFileV2();
  // Model mode (No Agent): allow documents + images
  // Agent mode: allow images only
  const IMAGE_EXTENSIONS_LIST = ["png", "jpg", "jpeg"];
  const DOC_EXTENSIONS_LIST = [
    "pdf", "docx", "pptx", "xlsx", "xls",                   // Documents
    "txt", "md", "csv",                                      // Text
    "py", "js", "ts", "java", "cpp", "c", "cs", "go",       // Code
    "json", "html", "css", "php", "rb", "sh", "tex",        // More code/markup
  ];
  const ALLOWED_EXTENSIONS = noAgentMode
    ? [...IMAGE_EXTENSIONS_LIST, ...DOC_EXTENSIONS_LIST]     // Model mode: all file types
    : IMAGE_EXTENSIONS_LIST;                                  // Agent mode: images only

  const uploadFile = (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) return;

    const id = crypto.randomUUID().slice(0, 10);
    setUploadFiles((prev) => [...prev, { id, file, loading: true, error: false }]);

    if (noAgentMode) {
      // Model mode: upload to MiBuddy dedicated container
      const formData = new FormData();
      formData.append("file", file);
      const tokenMatch = document.cookie.match(/(?:^|;\s*)access_token_lf=([^;]*)/);
      const headers: Record<string, string> = {};
      if (tokenMatch?.[1]) headers["Authorization"] = `Bearer ${decodeURIComponent(tokenMatch[1])}`;

      fetch(`${getURL("ORCHESTRATOR")}/upload`, {
        method: "POST",
        headers,
        credentials: "include",
        body: formData,
      })
        .then((res) => {
          if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
          return res.json();
        })
        .then((data) => {
          setUploadFiles((prev) =>
            prev.map((f) => (f.id === id ? { ...f, loading: false, path: data.file_path } : f)),
          );
        })
        .catch(() => {
          setUploadFiles((prev) =>
            prev.map((f) => (f.id === id ? { ...f, loading: false, error: true } : f)),
          );
        });
    } else {
      // Agent mode: upload to main storage (existing flow)
      uploadFileMutate(
        { file },
        {
          onSuccess: (data: any) => {
            setUploadFiles((prev) =>
              prev.map((f) => (f.id === id ? { ...f, loading: false, path: data.file_path } : f)),
            );
          },
          onError: () => {
            setUploadFiles((prev) =>
              prev.map((f) => (f.id === id ? { ...f, loading: false, error: true } : f)),
            );
          },
        },
      );
    }
  };

  const MAX_FILES = 5;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const currentCount = uploadFiles.length;
    const available = MAX_FILES - currentCount;

    if (available <= 0) {
      alert(`Maximum ${MAX_FILES} files allowed.`);
      e.target.value = "";
      return;
    }

    const filesToUpload = Array.from(files).slice(0, available);
    if (files.length > available) {
      alert(`Only ${available} more file(s) can be added. Maximum is ${MAX_FILES}.`);
    }

    for (const file of filesToUpload) {
      uploadFile(file);
    }
    e.target.value = "";
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const blob = items[i].getAsFile();
        if (blob) {
          e.preventDefault();
          uploadFile(blob);
          return;
        }
      }
    }
  };

  const removeFile = (id: string) => {
    setUploadFiles((prev) => prev.filter((f) => f.id !== id));
  };

  /* ------------------ SHAREPOINT FILE PICKER (Addon) ------------------ */

  const handleSpFilesSelected = (files: File[]) => {
    const rejected: string[] = [];
    for (const file of files) {
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
        rejected.push(file.name);
        continue;
      }
      uploadFile(file);
    }
    if (rejected.length > 0) {
      const allowedHint = noAgentMode
        ? "Allowed file types: documents and images."
        : "When an agent is selected, only image files are accepted. Switch to Model mode to upload documents.";
      useAlertStore.getState().setErrorData({
        title: "Some SharePoint files were not uploaded",
        list: [...rejected, allowedHint],
      });
    }
  };

  /* ------------------ API HOOKS ------------------ */

  const { data: apiAgents } = useGetOrchAgents();
  const { data: apiSessions, refetch: refetchSessions } = useGetOrchSessions();
  const { mutate: deleteSession } = useDeleteOrchSession();

  const agents: Agent[] = useMemo(
    () => (apiAgents ? mapApiAgents(apiAgents) : []),
    [apiAgents],
  );
  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedModelId) || agents[0],
    [agents, selectedModelId],
  );
  const canInteract = permissions?.includes("interact_agents") ?? false;

  // The effective session ID for fetching messages: activeSessionId is set
  // when the user clicks a session in the sidebar.  When null (e.g. after
  // streaming created a new session), fall back to currentSessionId if it
  // exists in the sessions list (meaning it was persisted to the DB).
  const effectiveSessionId = useMemo(() => {
    if (activeSessionId) return activeSessionId;
    if (apiSessions?.some((s) => s.session_id === currentSessionId)) return currentSessionId;
    return null;
  }, [activeSessionId, currentSessionId, apiSessions]);

  // Load messages when switching to an existing session
  const { data: apiSessionMessages, refetch: refetchMessages } = useGetOrchMessages(
    { session_id: effectiveSessionId || "" },
    {
      enabled: !!effectiveSessionId,
      refetchOnWindowFocus: true,
      staleTime: 0,
      // Prevent background polling from clobbering the local streaming placeholder/tokens.
      refetchInterval: isSending ? false : 5000,
    },
  );

  useEffect(() => {
    if (apiSessionMessages && effectiveSessionId) {
      // Keep local in-flight stream state intact for the active session.
      if (isSending && effectiveSessionId === currentSessionId) {
        return;
      }
      const mapped = mapApiMessages(apiSessionMessages);
      setMessages(mapped);
      setCurrentSessionId(effectiveSessionId);
      // Reset HITL UI state only when switching sessions (not on every poll).
      if (hitlSessionRef.current !== effectiveSessionId) {
        setHitlDoneMap({});
        setHitlLoadingId(null);
        hitlSessionRef.current = effectiveSessionId;
      }

      // Sync selected model with the session's active agent
      const sessionInfo = apiSessions?.find((s) => s.session_id === effectiveSessionId);
      if (sessionInfo?.active_agent_name) {
        const activeAgent = agents.find((a) => a.name === sessionInfo.active_agent_name);
        if (activeAgent) {
          setSelectedModelId(activeAgent.id);
        }
      }
    }
  }, [apiSessionMessages, effectiveSessionId, apiSessions, agents]);

  // Fetch available models from backend
  useEffect(() => {
    let cancelled = false;
    // Use native fetch to avoid axios duplicate-request interceptor
    const modelsUrl = `${getURL("ORCHESTRATOR")}/models`;
    const headers: Record<string, string> = {};
    // Extract JWT from cookie (same cookie name used by axios interceptor)
    const tokenMatch = document.cookie.match(/(?:^|;\s*)access_token_lf=([^;]*)/);
    if (tokenMatch?.[1]) {
      headers["Authorization"] = `Bearer ${decodeURIComponent(tokenMatch[1])}`;
    }

    fetch(modelsUrl, { headers, credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: any[]) => {
        if (cancelled || !data) return;
        const models: AiModelOption[] = data.map((m: any, idx: number) => ({
          id: m.model_id,
          name: m.display_name || m.model_name,
          icon: resolveModelIcon(m),
          group: (idx < 5 ? "main" : "more") as "main" | "more",
          capabilities: m.capabilities || undefined,
          is_default: m.is_default || false,
        }));
        setAiModels(models);
      })
      .catch((err) => {
        console.warn("[OrchestratorChat] Failed to fetch models:", err.message);
      });
    return () => { cancelled = true; };
  }, []);

  // Keep HITL status in sync when decisions happen on HITL Approvals page.
  // This lets orchestrator chat hide the pending banner and show final status
  // (Approved / Rejected / etc.) without requiring a full page reload.
  useEffect(() => {
    const hitlMsgs = messages.filter((m) => m.hitl && m.hitlThreadId);
    if (hitlMsgs.length === 0) return;

    let isMounted = true;
    const syncStatuses = async () => {
      try {
        const res = await api.get(`${getURL("HITL")}/pending`, {
          params: { status: "all" },
        });
        const rows: Array<{ thread_id?: string; status?: string; requested_at?: string }> = Array.isArray(res.data)
          ? res.data
          : [];

        // Build per-thread request timelines (oldest -> newest).
        const reqByThread = new Map<string, Array<{ status: string; requestedAt: number }>>();
        for (const row of rows) {
          if (!row?.thread_id || !row?.status) continue;
          const list = reqByThread.get(row.thread_id) ?? [];
          list.push({
            status: row.status,
            requestedAt: row.requested_at ? Date.parse(row.requested_at) : 0,
          });
          reqByThread.set(row.thread_id, list);
        }
        for (const list of reqByThread.values()) {
          list.sort((a, b) => a.requestedAt - b.requestedAt);
        }

        // Build per-thread HITL message timelines in chat order.
        const msgByThread = new Map<string, Message[]>();
        for (const msg of hitlMsgs) {
          const threadId = msg.hitlThreadId ?? "";
          const list = msgByThread.get(threadId) ?? [];
          list.push(msg);
          msgByThread.set(threadId, list);
        }

        // Assign status to each HITL message by timeline index in the same thread.
        const nextMap: Record<string, string> = {};
        for (const [threadId, threadMsgs] of msgByThread.entries()) {
          const threadReqs = reqByThread.get(threadId) ?? [];
          for (let i = 0; i < threadMsgs.length; i++) {
            const req = threadReqs[i];
            if (!req) continue;
            if (req.status.toLowerCase() !== "pending") {
              nextMap[threadMsgs[i].id] = hitlStatusLabel(req.status);
            }
          }
        }

        if (!isMounted) return;
        setHitlDoneMap(nextMap);
      } catch {
        // Best-effort status sync only; keep existing UI if polling fails.
      }
    };

    syncStatuses();
    const timer = window.setInterval(syncStatuses, 4000);
    return () => {
      isMounted = false;
      window.clearInterval(timer);
    };
  }, [messages]);

  // Set default selected model when agents load (skip if user chose "No Agent" mode)
  useEffect(() => {
    if (agents.length > 0 && !selectedModelId && !noAgentMode) {
      setSelectedModelId(agents[0].id);
    }
  }, [agents, selectedModelId, noAgentMode]);

  // Auto-disable COT when user switches to a non-Gemini model (or leaves model mode).
  useEffect(() => {
    if (!cotReasoning) return;
    const current = aiModels.find((m) => m.id === selectedAiModel);
    const modelName = (current?.name || "").toLowerCase();
    const isGemini = /\b(gemini|google)\b/.test(modelName) && /\b(2\.5|3|3\.\d+)\b/.test(modelName);
    if (!noAgentMode || !isGemini) {
      setCotReasoning(false);
    }
  }, [selectedAiModel, noAgentMode, aiModels, cotReasoning]);

  // Update filteredAgents when agents load
  useEffect(() => {
    setFilteredAgents(agents);
  }, [agents]);

  useEffect(() => {
    // Use instant scroll while streaming so it keeps up with fast tokens;
    // smooth scroll otherwise for a nicer UX.
    messagesEndRef.current?.scrollIntoView({
      behavior: isSending ? "auto" : "smooth",
    });
  }, [messages, isSending, streamingAgentName]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
      if (!(e.target as Element)?.closest?.("[data-plus-menu]")) {
        setShowPlusMenu(false);
      }
      if (aiModelPickerRef.current && !aiModelPickerRef.current.contains(e.target as Node)) {
        setShowAiModelPicker(false);
        setShowMoreModels(false);
      }
      // Close three-dot chat menu when clicking outside
      if (!(e.target as Element)?.closest?.("[data-chat-menu]")) {
        setChatMenuOpenId(null);
      }
      // Close per-message export menu when clicking outside
      if (!(e.target as Element)?.closest?.("[data-export-menu]")) {
        setExportMenuOpenId(null);
      }
      // Close suggestions when clicking outside input area
      if (!(e.target as Element)?.closest?.("textarea")) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  /* ------------------ HELPERS ------------------ */

  const timeNow = () =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const highlightMentions = (text: string) => {
    // Build a regex that matches any known @agent_name (including spaces)
    // so "@smart agent" is bolded as one unit, not just "@smart".
    if (agents.length === 0) return [text];
    const escaped = [...agents]
      .sort((a, b) => b.name.length - a.name.length)
      .map((a) => a.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(`(@(?:${escaped.join("|")}))`, "gi");
    return text.split(pattern).map((part, i) =>
      part.startsWith("@") ? (
        <span key={i} className="font-semibold text-primary">
          {part}
        </span>
      ) : (
        part
      )
    );
  };

  const getAgentColor = (name?: string) => {
    const agent = agents.find((a) => a.name === name);
    return agent?.color || "#10a37f";
  };

  const versionBadge = (versionLabel: string) => (
    <span className="ml-2 inline-flex items-center rounded-full border border-border bg-muted px-1.5 py-0.5 text-xxs font-semibold uppercase leading-none text-muted-foreground">
      {versionLabel}
    </span>
  );

  const uatBadge = (environment: string) =>
    String(environment).toLowerCase() === "uat" ? (
      <span className="ml-1.5 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xxs font-semibold uppercase leading-none text-amber-700">
        UAT
      </span>
    ) : null;

  /* ------------------ HITL ACTION HANDLER ------------------ */

  const handleHitlAction = useCallback(
    async (msgId: string, threadId: string, action: string) => {
      if (hitlDoneMap[msgId] || hitlLoadingId) return;
      setHitlLoadingId(msgId);
      setHitlLoadingAction(action);
      try {
        const res = await api.post(`${getURL("HITL")}/${threadId}/resume`, {
          action,
          feedback: "",
          edited_value: "",
        });
        setHitlDoneMap((prev) => ({ ...prev, [msgId]: action }));

        const resData = res.data;

        if (resData?.status === "interrupted" && resData.interrupt_data) {
          // Another HITL node was hit downstream — show new approval message
          const newInterrupt = resData.interrupt_data;
          const question = newInterrupt.question || "Approval required";
          const newActions: string[] = newInterrupt.actions || [];
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              sender: "agent",
              agentName: prev.find((m) => m.id === msgId)?.agentName,
              content: question,
              timestamp: timeNow(),
              hitl: true,
              hitlActions: newActions,
              hitlThreadId: threadId,
            },
          ]);
        } else if (resData?.status === "completed") {
          // Graph finished — show only resumed AI output in orchestrator chat.
          setMessages((prev) => {
            const name = prev.find((m) => m.id === msgId)?.agentName;
            if (!resData.output_text) return prev;
            return [
              ...prev,
              {
                id: crypto.randomUUID(),
                sender: "agent" as const,
                agentName: name,
                content: resData.output_text,
                timestamp: timeNow(),
              },
            ];
          });
          // Refetch messages from DB so the persisted orch_conversation
          // response is available if user reloads or navigates away.
          refetchMessages();
        }
      } catch (_err) {
        // leave buttons enabled so user can retry
      } finally {
        setHitlLoadingId(null);
        setHitlLoadingAction(null);
      }
    },
    [hitlDoneMap, hitlLoadingId, timeNow, refetchMessages],
  );

  /* ------------------ INPUT HANDLING ------------------ */

  const handleInputChange = (value: string) => {
    setInput(value);
    const match = value.match(/@([\w\s().-]*)$/);
    if (match && !noAgentMode) {
      const query = match[1].toLowerCase();
      setFilteredAgents(agents.filter((a) => a.name.toLowerCase().includes(query)));
      setShowMentions(true);
    } else {
      setShowMentions(false);
    }

    // Autocomplete suggestions — only in model mode, debounced fetch
    if (suggestionTimerRef.current) clearTimeout(suggestionTimerRef.current);
    setSelectedSuggestionIdx(-1);
    if (!noAgentMode || value.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    suggestionTimerRef.current = setTimeout(() => {
      const suggestUrl = `${getURL("ORCHESTRATOR")}/suggestions?q=${encodeURIComponent(value.trim())}`;
      const headers: Record<string, string> = {};
      const tokenMatch = document.cookie.match(/(?:^|;\s*)access_token_lf=([^;]*)/);
      if (tokenMatch?.[1]) headers["Authorization"] = `Bearer ${decodeURIComponent(tokenMatch[1])}`;
      fetch(suggestUrl, { headers, credentials: "include" })
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          const items: string[] = data?.suggestions || [];
          setSuggestions(items);
          setShowSuggestions(items.length > 0);
        })
        .catch(() => { setSuggestions([]); setShowSuggestions(false); });
    }, 400);
  };

  const handleSelectSuggestion = (text: string) => {
    setInput(text);
    setSuggestions([]);
    setShowSuggestions(false);
    setSelectedSuggestionIdx(-1);
    textareaRef.current?.focus();
  };

  const handleSelectAgent = (agent: Agent) => {
    const updated = input.replace(/@[\w\s().-]*$/, `@${agent.name} `);
    setInput(updated);
    setSelectedModelId(agent.id);
    setShowMentions(false);
    textareaRef.current?.focus();
  };

  /* ------------------ SPEECH-TO-TEXT (MIC) ------------------ */

  const handleMicClick = useCallback(() => {
    // Stop listening
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    // Start listening
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser. Please use Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognitionRef.current = recognition;
    setIsListening(true);

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput((prev) => (prev ? prev + " " + transcript : transcript));
      textareaRef.current?.focus();
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  }, [isListening]);

  /* ------------------ TEXT-TO-SPEECH (SPEAKER) ------------------ */

  const handleSpeak = useCallback((text: string) => {
    const synth = window.speechSynthesis;
    if (!synth) return;

    // If already speaking, stop
    if (synth.speaking) {
      synth.cancel();
      return;
    }

    // Strip markdown for cleaner speech
    const clean = text
      .replace(/!\[.*?\]\(.*?\)/g, "")          // remove images
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")  // links → text
      .replace(/[*_~`#>|\\-]{1,3}/g, "")        // remove markdown symbols
      .replace(/```[\s\S]*?```/g, "")            // remove code blocks
      .replace(/\n{2,}/g, ". ")                  // paragraphs → pause
      .replace(/\n/g, " ")
      .trim();

    if (!clean) return;

    const utterance = new SpeechSynthesisUtterance(clean);
    synth.speak(utterance);
  }, []);

  /* ------------------ EXPORT MESSAGE (DOCX / PDF) ------------------ */

  const renderMarkdownToHtml = useCallback((md: string): string => {
    // Lightweight markdown → HTML (headings, bold, italic, code, links, lists, line breaks)
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let html = esc(md);
    html = html.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code}</code></pre>`);
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/^###### (.*)$/gm, "<h6>$1</h6>");
    html = html.replace(/^##### (.*)$/gm, "<h5>$1</h5>");
    html = html.replace(/^#### (.*)$/gm, "<h4>$1</h4>");
    html = html.replace(/^### (.*)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.*)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.*)$/gm, "<h1>$1</h1>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    html = html.replace(/^\s*[-*+] (.*)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>");
    html = html.replace(/\n{2,}/g, "</p><p>");
    html = html.replace(/\n/g, "<br/>");
    return `<p>${html}</p>`;
  }, []);

  const handleExportDocx = useCallback((text: string) => {
    if (!text) return;
    const body = renderMarkdownToHtml(text);
    const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>Export</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.5;}h1,h2,h3,h4{color:#1a1a1a;}pre{background:#f5f5f5;padding:8px;border-radius:4px;font-family:Consolas,monospace;white-space:pre-wrap;}code{background:#f5f5f5;padding:2px 4px;border-radius:3px;font-family:Consolas,monospace;}</style></head><body>${body}</body></html>`;
    const blob = new Blob(["\ufeff", html], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `response-${Date.now()}.doc`;
    a.click();
    URL.revokeObjectURL(url);
  }, [renderMarkdownToHtml]);

  const handleExportPdf = useCallback((text: string) => {
    if (!text) return;
    const body = renderMarkdownToHtml(text);
    const printWindow = window.open("", "_blank", "width=800,height=600");
    if (!printWindow) return;
    printWindow.document.write(`<html><head><title>Export</title><style>body{font-family:Arial,sans-serif;font-size:12pt;line-height:1.6;max-width:800px;margin:40px auto;padding:0 20px;color:#1a1a1a;}h1,h2,h3,h4{color:#000;}pre{background:#f5f5f5;padding:10px;border-radius:4px;font-family:Consolas,monospace;white-space:pre-wrap;overflow-x:auto;}code{background:#f5f5f5;padding:2px 4px;border-radius:3px;font-family:Consolas,monospace;}a{color:#2563eb;}@media print{body{margin:0;}}</style></head><body>${body}<script>window.onload=function(){window.print();setTimeout(function(){window.close();},500);}</script></body></html>`);
    printWindow.document.close();
  }, [renderMarkdownToHtml]);

  const handleExportText = useCallback((text: string) => {
    if (!text) return;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `response-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleCopyMessage = useCallback(async (text: string, msgId: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for non-secure contexts
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
    }
    setCopiedMsgId(msgId);
    setTimeout(() => setCopiedMsgId((id) => (id === msgId ? null : id)), 1500);
  }, []);

  /* ------------------ SEND MESSAGE ------------------ */

  const handleSend = useCallback(async () => {
    const hasFiles = uploadFiles.some((f) => f.path && !f.loading && !f.error);
    if (!canInteract || (!input.trim() && !hasFiles) || isSending) return;

    // Detect explicit @mention — auto-select the agent if user typed @agent_name
    // Sort by name length descending so "rag agent_new" matches before "rag agent".
    const explicitAgent = [...agents]
      .sort((a, b) => b.name.length - a.name.length)
      .find((a) => input.includes(`@${a.name}`));

    // If user @mentioned an agent, switch out of noAgentMode and select it
    if (explicitAgent) {
      if (noAgentMode) setNoAgentMode(false);
      if (explicitAgent.id !== selectedModelId) setSelectedModelId(explicitAgent.id);
    }

    // Block send when no agent or model is selected (and no @mention detected)
    if (!explicitAgent) {
      const needsAgent = !noAgentMode && !selectedModelId;
      const needsModel = noAgentMode && !selectedAiModel;
      if (needsAgent || needsModel || (!noAgentMode && agents.length === 0)) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            sender: "user" as const,
            content: input,
            timestamp: timeNow(),
          },
          {
            id: crypto.randomUUID(),
            sender: "agent" as const,
            content: t("Please select an agent or model first to start chatting."),
            timestamp: timeNow(),
          },
        ]);
        setInput("");
        return;
      }
    }

    // Collect uploaded file paths and clear previews
    const filePaths = uploadFiles
      .filter((f) => f.path && !f.loading && !f.error)
      .map((f) => f.path!);
    setUploadFiles([]);

    const fallbackAgent = selectedAgent || agents[0];

    // Target agent: explicit @mention wins, otherwise use sticky (selectedModel)
    const targetAgent = explicitAgent || fallbackAgent;

    // Strip the @agent_name mention so the agent only receives the actual question
    const escapedName = explicitAgent
      ? explicitAgent.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      : "";
    const cleanedInput = explicitAgent
      ? input.replace(new RegExp(`@${escapedName}\\s*`, "g"), "").trim()
      : input.trim();

    // Agent message placeholder — created upfront so "Thinking..." shows inside the bubble
    const agentMsgId = crypto.randomUUID();
    setStreamingMsgId(agentMsgId);

    // Determine display name for the responding entity
    const responderName = (noAgentMode && selectedAiModel)
      ? (aiModels.find((m) => m.id === selectedAiModel)?.name || "AI Model")
      : targetAgent.name;

    // Add both user message AND agent "thinking" placeholder.
    // flushSync commits the DOM update synchronously, then we await a
    // double-rAF to guarantee the browser has actually painted the
    // "Thinking..." indicator before the network request begins.
    const userMessage: Message = {
      id: crypto.randomUUID(),
      sender: "user",
      content: input,
      timestamp: timeNow(),
      files: filePaths.length > 0 ? filePaths : undefined,
      canvasEnabled: isCanvasEnabled || undefined,
    };
    flushSync(() => {
      setMessages((prev) => [
        ...prev,
        userMessage,
        {
          id: agentMsgId,
          sender: "agent" as const,
          agentName: responderName,
          content: "",  // empty = "Thinking..." state
          timestamp: timeNow(),
        },
      ]);
      setInput("");
      setShowMentions(false);
      setIsSending(true);
      setStreamingAgentName(responderName);
    });

    // Wait for the browser to actually paint the thinking state.
    // Double-rAF: first rAF fires before paint, second fires after paint.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

    let accumulated = "";
    let accumulatedReasoning = "";
    let rafHandle: number | null = null;
    let pendingContent: string | null = null;
    let hitlPauseReceived = false;
    let receivedToken = false;
    let latestAgentAddMessageText = "";

    // Flush the latest accumulated content to React state.
    // Called inside a rAF so we update at most once per frame (~60fps),
    // keeping the UI responsive while still showing progressive tokens.
    const flushToReact = () => {
      rafHandle = null;
      if (pendingContent === null) return;
      const content = pendingContent;
      const reasoning = accumulatedReasoning || undefined;
      pendingContent = null;
      flushSync(() => {
        setStreamingAgentName("");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentMsgId ? { ...m, content, reasoningContent: reasoning } : m,
          ),
        );
      });
    };

    // Helper: update the agent message bubble content.
    // Tokens arrive very rapidly; we accumulate them and schedule
    // a single React update per animation frame to stay smooth.
    const updateAgentMsg = (content: string, immediate = false) => {
      accumulated = content;
      if (immediate) {
        // For final/error updates, flush synchronously
        if (rafHandle !== null) { cancelAnimationFrame(rafHandle); rafHandle = null; }
        pendingContent = null;
        const reasoning = accumulatedReasoning || undefined;
        flushSync(() => {
          setStreamingAgentName("");
          setMessages((prev) =>
            prev.map((m) =>
              m.id === agentMsgId ? { ...m, content, reasoningContent: reasoning } : m,
            ),
          );
        });
        return;
      }
      pendingContent = content;
      if (rafHandle === null) {
        rafHandle = requestAnimationFrame(flushToReact);
      }
    };

    // Build request body: @agent mode sends agent_id, model mode sends model_id.
    const requestBody: any = {
      session_id: currentSessionId,
      input_value: cleanedInput,
    };

    if (explicitAgent || !noAgentMode) {
      // Agent mode: send agent details
      requestBody.agent_id = targetAgent.agent_id;
      requestBody.deployment_id = targetAgent.deploy_id;
      requestBody.version_number = targetAgent.version_number;
      requestBody.env = targetAgent.environment || "uat";
    } else if (noAgentMode && selectedAiModel) {
      // Model mode: send model_id (UUID from registry)
      requestBody.model_id = selectedAiModel;
    }

    // Send COT reasoning preference
    if (cotReasoning) {
      requestBody.enable_reasoning = true;
    }

    // Image mode: explicit flag — backend skips intent classification and routes to image generation
    if (imageMode) {
      requestBody.image_mode = true;
    }

    if (filePaths.length > 0) {
      requestBody.files = filePaths;
    }
    console.log("[OrchestratorChat] Request body:", JSON.stringify(requestBody), "| filePaths:", filePaths, "| uploadFiles:", uploadFiles.map(f => ({id: f.id, path: f.path, loading: f.loading, error: f.error})));

    const buildController = new AbortController();

    try {
      await performStreamingRequest({
        method: "POST",
        url: `${getURL("ORCHESTRATOR")}/chat/stream`,
        body: requestBody,
        buildController,
        onData: async (event: any) => {
          const eventType: string = event?.event;
          const data: any = event?.data;

          const isHitlEvent =
            eventType === "add_message" &&
            (
              !!data?.properties?.hitl ||
              inferHitlFromText(String(data?.text || data?.message || ""))
            );

          if (isHitlEvent) {
            // HITL pause event — update agent message with HITL metadata
            // so the UI renders approval action buttons.
            hitlPauseReceived = true;
            const actions: string[] = Array.isArray(data?.properties?.actions)
              ? data.properties.actions
              : extractHitlActions(String(data?.text || data?.message || ""));
            const threadId: string = data?.properties?.thread_id ?? currentSessionId ?? "";
            const hitlText: string = data.text || data.message || "";
            const isDeployedRun: boolean = data?.properties?.is_deployed_run ?? true;
            flushSync(() => {
              setStreamingAgentName("");
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === agentMsgId
                    ? {
                        ...m,
                        content: hitlText,
                        hitl: true,
                        hitlActions: actions,
                        hitlThreadId: threadId,
                        hitlIsDeployed: isDeployedRun,
                      }
                    : m,
                ),
              );
            });
            // Don't return false — let the stream continue to consume
            // remaining events (end_vertex, end).
          } else if (eventType === "add_message" && data?.content_blocks?.length) {
            // Only show content_blocks that contain actual tool calls.
            // Each flow node (Chat Input, Worker Node, Chat Output) sends its
            // own add_message event; pipeline nodes only carry plain text steps
            // which would appear as duplicate Input/Output entries. Filtering
            // to tool_use blocks means we only show meaningful agent reasoning.
            const toolBlocks = data.content_blocks.filter((block: any) =>
              block.contents?.some((c: any) => c.type === "tool_use"),
            );
            if (toolBlocks.length > 0) {
              flushSync(() => {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === agentMsgId
                      ? {
                          ...m,
                          // Replace (not append) — each add_message is a
                          // progressive update of the same Worker Node message
                          // (Accessing → Executed), not a new block.
                          contentBlocks: toolBlocks,
                          blocksState: "partial",
                        }
                      : m,
                  ),
                );
              });
            }
          } else if (eventType === "add_message" && (data?.text || data?.message) && !hitlPauseReceived) {
            // Keep add_message text as a fallback, but don't immediately overwrite
            // the thinking bubble. Some graphs emit user/input-node add_message
            // events before AI tokens; rendering those here causes echo + no stream UX.
            const sender = String(data?.sender || data?.sender_name || "").toLowerCase();
            const isUserMessage = sender.includes("user");
            const addMessageText = String(data.text || data.message || "");
            if (!isUserMessage && addMessageText.trim()) {
              latestAgentAddMessageText = addMessageText;
            }
          } else if (eventType === "token" && data?.chunk) {
            // Progressive streaming — append each token chunk (throttled)
            receivedToken = true;
            if (data.type === "reasoning") {
              // CoT reasoning chunk — accumulate separately
              accumulatedReasoning += data.chunk;
              updateAgentMsg(accumulated); // trigger re-render to show reasoning
            } else {
              accumulated += data.chunk;
              updateAgentMsg(accumulated);
            }
          } else if (eventType === "error") {
            updateAgentMsg(data?.text || "An error occurred", true);
            return false;
          } else if (eventType === "end") {
            // Capture reasoning from end event if provided
            if (data?.reasoning_content) {
              accumulatedReasoning = data.reasoning_content;
            }
            // End event carries the final complete text — flush immediately.
            // BUT: if we received a HITL pause, do NOT overwrite the HITL
            // message with agent_text — the action buttons must stay visible.
            if (data?.agent_text && !hitlPauseReceived) {
              updateAgentMsg(data.agent_text, true);
            } else if (!hitlPauseReceived && !receivedToken && latestAgentAddMessageText.trim()) {
              // Fallback for non-token flows where response text came only via
              // add_message and end has no agent_text payload.
              updateAgentMsg(latestAgentAddMessageText, true);
            }
            // Mark content blocks as fully finished
            if (!hitlPauseReceived) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === agentMsgId && m.contentBlocks?.length
                    ? { ...m, blocksState: "complete" }
                    : m,
                ),
              );
            }
            refetchSessions();
            // Force a fast message sync for existing sessions so local streamed
            // content is not replaced by stale polled data.
            if (effectiveSessionId) {
              refetchMessages();
            }
            return false;
          }
          return true;
        },
        onError: (statusCode) => {
          updateAgentMsg(`Error: server returned ${statusCode}`, true);
        },
        onNetworkError: (error) => {
          if (error.name !== "AbortError") {
            updateAgentMsg("Sorry, something went wrong. Please try again.", true);
          }
        },
      });
    } catch {
      if (!accumulated) {
        updateAgentMsg("Sorry, something went wrong. Please try again.", true);
      }
    } finally {
      // Flush any remaining buffered content and clean up
      if (rafHandle !== null) { cancelAnimationFrame(rafHandle); rafHandle = null; }
      if (pendingContent !== null) {
        const finalContent = pendingContent;
        pendingContent = null;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentMsgId ? { ...m, content: finalContent } : m,
          ),
        );
      } else if (!hitlPauseReceived && !receivedToken && latestAgentAddMessageText.trim()) {
        // Defensive fallback if stream closes before we get a parsable end event.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentMsgId ? { ...m, content: latestAgentAddMessageText } : m,
          ),
        );
      }
      setIsSending(false);
      setStreamingAgentName("");
      setStreamingMsgId(null);
    }
  }, [canInteract, input, isSending, agents, selectedAgent, selectedModelId, noAgentMode, selectedAiModel, currentSessionId, effectiveSessionId, refetchSessions, refetchMessages, imageMode, cotReasoning]);

  /* ------------------ SESSION MANAGEMENT ------------------ */

  const handleNewChat = () => {
    setCurrentSessionId(crypto.randomUUID());
    setActiveSessionId(null);
    setMessages([]);
    setSelectedModelId("");
    setNoAgentMode(true);
    setShowImageGallery(false);
  };

  const handleSelectSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setShowImageGallery(false);
  };

  const handleDeleteSession = (sessionId: string) => {
    deleteSession(
      { session_id: sessionId },
      {
        onSuccess: () => {
          if (currentSessionId === sessionId) {
            handleNewChat();
          }
          refetchSessions();
        },
      },
    );
  };

  const handleArchiveSession = async (sessionId: string, isArchived: boolean) => {
    try {
      await api.post(`${getURL("ORCHESTRATOR")}/sessions/${sessionId}/archive`, {
        is_archived: isArchived,
      });
      if (currentSessionId === sessionId && isArchived) {
        handleNewChat();
      }
      refetchSessions();
    } catch (err) {
      console.error("Failed to archive session:", err);
    }
  };

  /* ---- group chat history by date ---- */
  const activeSessions = useMemo(
    () => (apiSessions || []).filter((s) => !s.is_archived),
    [apiSessions],
  );
  const archivedSessions = useMemo(
    () => (apiSessions || []).filter((s) => s.is_archived),
    [apiSessions],
  );

  // Filter sessions by search query (matches preview text)
  const filteredActiveSessions = useMemo(() => {
    const q = sidebarSearchQuery.trim().toLowerCase();
    if (!q) return activeSessions;
    return activeSessions.filter(
      (s) =>
        (s.preview || "").toLowerCase().includes(q) ||
        (s.active_agent_name || "").toLowerCase().includes(q),
    );
  }, [activeSessions, sidebarSearchQuery]);

  const filteredArchivedSessions = useMemo(() => {
    const q = sidebarSearchQuery.trim().toLowerCase();
    if (!q) return archivedSessions;
    return archivedSessions.filter(
      (s) =>
        (s.preview || "").toLowerCase().includes(q) ||
        (s.active_agent_name || "").toLowerCase().includes(q),
    );
  }, [archivedSessions, sidebarSearchQuery]);

  const grouped = useMemo(
    () => groupSessionsByDate(filteredActiveSessions, t),
    [filteredActiveSessions, t],
  );
  const groupedArchived = useMemo(
    () => groupSessionsByDate(filteredArchivedSessions, t),
    [filteredArchivedSessions, t],
  );

  /* ------------------ RENDER ------------------ */

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* ================ SIDEBAR ================ */}
      <div
        className={`flex flex-col overflow-hidden border-r border-border bg-muted transition-all duration-200 ${
          sidebarOpen ? "w-64 min-w-[16rem]" : "w-0 min-w-0"
        }`}
      >
        {/* Sidebar Header */}
        <div className="flex items-center justify-between p-3">
          <button
            onClick={() => setSidebarOpen(false)}
            className="flex items-center rounded-md p-1.5 text-muted-foreground hover:bg-accent"
          >
            <PanelLeftClose size={18} />
          </button>
        </div>

        {/* ---- Single scrollable region containing nav + apps + info + agents.
              Without this, expanding "Chat history" pushed the Applications
              and Agents sections off-screen because the sidebar itself is
              overflow-hidden. */}
        <div
          className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-smooth"
          style={{ scrollbarWidth: "thin" }}
        >
        {/* ---- Addon: Sidebar Navigation Items ---- */}
        <div className="flex flex-col gap-0.5 px-2 pb-2">
          {/* New chat */}
          <button
            onClick={() => {
              // Close any inline panel (NotebookLM / Image gallery) first,
              // otherwise the chat view stays hidden behind them and the
              // click silently does nothing from the user's POV.
              setShowNotebookLM(false);
              setShowImageGallery(false);
              handleNewChat();
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-accent"
          >
            <SidebarMaskIcon src={miNewChatIcon} />
            <span>{t("New chat")}</span>
          </button>

          {/* Search chats */}
          <button
            onClick={() => {
              setShowSearchInput(true);
              setSidebarSearchQuery("");
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-accent"
          >
            <SidebarMaskIcon src={miSearchIcon} />
            <span>{t("Search chats")}</span>
          </button>

          {/* Search overlay */}
          {showSearchInput && (
            <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[10vh]" onClick={() => { setShowSearchInput(false); setSidebarSearchQuery(""); }}>
              <div
                className="w-full max-w-lg rounded-xl bg-background shadow-2xl border border-border"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Search input header */}
                <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                  <input
                    type="text"
                    value={sidebarSearchQuery}
                    onChange={(e) => setSidebarSearchQuery(e.target.value)}
                    placeholder={t("Search chats...")}
                    className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                    autoFocus
                  />
                  <button
                    onClick={() => { setShowSearchInput(false); setSidebarSearchQuery(""); }}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* New chat button */}
                <button
                  onClick={() => { setShowSearchInput(false); setSidebarSearchQuery(""); handleNewChat(); }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-sm font-medium text-foreground hover:bg-accent"
                >
                  <SquarePen size={16} className="shrink-0 text-muted-foreground" />
                  <span>{t("New-chat")}</span>
                </button>

                {/* Recent sessions list */}
                <div className="max-h-[50vh] overflow-y-auto px-2 pb-3" style={{ scrollbarWidth: "thin" }}>
                  {Object.entries(grouped).length === 0 && sidebarSearchQuery.trim() ? (
                    <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                      {t("No matching chats")}
                    </div>
                  ) : (
                    Object.entries(grouped).map(([date, chats]) => (
                      <div key={date} className="mb-1">
                        <div className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {date}
                        </div>
                        {chats.map((chat) => (
                          <button
                            key={chat.session_id}
                            onClick={() => { setShowSearchInput(false); setSidebarSearchQuery(""); handleSelectSession(chat.session_id); }}
                            className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-accent ${
                              currentSessionId === chat.session_id ? "bg-accent" : ""
                            }`}
                          >
                            <MessageSquare size={14} className="mt-0.5 shrink-0 opacity-50" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium text-foreground">
                                {chat.active_agent_name || t("Chat")}
                                {chat.active_agent_name ? ` - ${chat.active_agent_name}` : ""}
                              </div>
                              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                                {chat.preview || t("New conversation")}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Image — toggles gallery view in main area */}
          <button
            onClick={() => {
              setShowImageGallery(!showImageGallery);
              setShowNotebookLM(false);
            }}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-accent ${showImageGallery ? "bg-accent" : ""}`}
          >
            <SidebarMaskIcon src={imageLibraryLogo} />
            <span>{t("Image")}</span>
          </button>

          {/* Chat history (collapsible) — contains all conversations */}
          <button
            onClick={() => setShowChatHistoryExpand(!showChatHistoryExpand)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-accent"
          >
            <SidebarMaskIcon src={miChatHistoryIcon} />
            <span className="flex-1 text-left">{t("Chat history")}</span>
            <ChevronRight size={14} className={`text-muted-foreground transition-transform ${showChatHistoryExpand ? "rotate-90" : ""}`} />
          </button>
          {showChatHistoryExpand && (
            <div className="ml-4 border-l border-border pl-1">
              {Object.entries(grouped).map(([date, chats]) => (
                <div key={date} className="mb-2">
                  <div className="px-3 pb-1 pt-2 text-xxs font-semibold uppercase tracking-wide text-muted-foreground">
                    {date}
                  </div>
                  {chats.map((chat) => (
                    <div
                      key={chat.session_id}
                      className="group relative flex items-center"
                    >
                      <button
                        onClick={() => handleSelectSession(chat.session_id)}
                        className={`flex min-w-0 flex-1 items-center gap-2 truncate rounded-lg px-3 py-2 pr-8 text-left text-sm text-foreground hover:bg-accent ${
                          currentSessionId === chat.session_id ? "bg-accent" : ""
                        }`}
                      >
                        <MessageSquare size={14} className="shrink-0 opacity-50" />
                        <span className="truncate">{chat.preview || t("New conversation")}</span>
                      </button>
                      {/* Three-dot menu button — visible on hover */}
                      <button
                        data-chat-menu
                        onClick={(e) => {
                          e.stopPropagation();
                          if (chatMenuOpenId === chat.session_id) {
                            setChatMenuOpenId(null);
                          } else {
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setChatMenuPos({ top: rect.bottom + 4, left: rect.right - 140 });
                            setChatMenuOpenId(chat.session_id);
                          }
                        }}
                        className="invisible absolute right-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground group-hover:visible"
                        title={t("Options")}
                      >
                        <MoreVertical size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Archive Chat (collapsible) */}
          <button
            onClick={() => setShowArchiveChatExpand(!showArchiveChatExpand)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-accent"
          >
            <SidebarMaskIcon src={miArchiveIcon} />
            <span className="flex-1 text-left">{t("Archive Chat")}</span>
            <ChevronRight size={14} className={`text-muted-foreground transition-transform ${showArchiveChatExpand ? "rotate-90" : ""}`} />
          </button>
          {showArchiveChatExpand && (
            <div className="ml-4 border-l border-border pl-1">
              {archivedSessions.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  {t("No archived chats")}
                </div>
              ) : (
                Object.entries(groupedArchived).map(([date, chats]) => (
                  <div key={date} className="mb-2">
                    <div className="px-3 pb-1 pt-2 text-xxs font-semibold uppercase tracking-wide text-muted-foreground">
                      {date}
                    </div>
                    {chats.map((chat) => (
                      <div
                        key={chat.session_id}
                        className="group relative flex items-center"
                      >
                        <button
                          onClick={() => handleSelectSession(chat.session_id)}
                          className={`flex min-w-0 flex-1 items-center gap-2 truncate rounded-lg px-3 py-2 pr-8 text-left text-sm text-muted-foreground hover:bg-accent ${
                            currentSessionId === chat.session_id ? "bg-accent" : ""
                          }`}
                        >
                          <Archive size={14} className="shrink-0 opacity-50" />
                          <span className="truncate">{chat.preview || t("New conversation")}</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleArchiveSession(chat.session_id, false);
                          }}
                          className="invisible absolute right-1 shrink-0 rounded p-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground group-hover:visible"
                          title={t("Unarchive")}
                        >
                          <ArrowLeft size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* ---- Addon: Applications Section ---- */}
        <div className="border-t border-border px-2 pb-2 pt-2">
          <div className="px-3 pb-1 text-xxs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("Applications")}
          </div>
          <div className="flex flex-col gap-0.5">
            <button
              onClick={() => window.open("https://translator.motherson.com", "_blank")}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-accent"
            >
              <img src={translatorLogo} alt="" className="h-4 w-4 shrink-0 object-contain" />
              <span>{t("AI Translator")}</span>
            </button>
            <button
              onClick={() => window.open("https://genai.motherson.com/do33", "_blank")}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-accent"
            >
              <img src={imageLibraryLogo} alt="" className="h-4 w-4 shrink-0 object-contain" />
              <span>{t("DO33")}</span>
            </button>
            <button
              onClick={() => {
                setShowNotebookLM(true);
                setShowImageGallery(false);
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-accent ${showNotebookLM ? "bg-accent" : ""}`}
            >
              <img src={notebookLMLogo} alt="" className="h-4 w-4 shrink-0 object-contain" />
              <span>{t("NotebookLM")}</span>
            </button>
          </div>
        </div>

        {/* ---- Addon: Information & Help (wired same as MiBuddy) ----
              Information → opens the MiBuddy user-manual PDF in a new tab.
              Help → opens the user's mail client pre-populated to the
              MiBuddy support distribution lists. */}
        <div className="border-t border-border px-2 pb-3 pt-2">
          <button
            onClick={() =>
              window.open(
                "https://mibuddystorageaccount.blob.core.windows.net/genieusermanual/MIBuddyusermanual.pdf",
                "_blank",
              )
            }
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-accent"
          >
            <SidebarMaskIcon src={miInformationIcon} />
            <span>{t("Information")}</span>
          </button>
          <button
            onClick={() => {
              const subject = encodeURIComponent(
                "MiBuddy : Please detail the support required",
              );
              window.location.href = `mailto:support.mtsl@motherson.com,MiBuddy.Feedback@motherson.com?subject=${subject}`;
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-accent"
          >
            <SidebarMaskIcon src={miHelpIcon} />
            <span>{t("Help")}</span>
          </button>
        </div>

        {/* Agents Panel — no internal scroll; participates in the single
            sidebar scroll defined by the parent wrapper. */}
        <div className="flex shrink-0 flex-col border-t border-border">
          <div className="shrink-0 px-4 pb-2 pt-3 text-xxs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("Agents")}
          </div>
          <div className="px-2 pb-2">
            <div className="flex flex-col gap-0.5">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => {
                    setSelectedModelId(agent.id);
                    setShowModelPicker(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] text-foreground hover:bg-accent ${
                    selectedModelId === agent.id ? "bg-accent" : ""
                  }`}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: agent.online ? agent.color : undefined }}
                  />
                  <span className="flex min-w-0 items-center">
                    <span className="truncate">{agent.name}</span>
                    {versionBadge(agent.version_label)}
                    {uatBadge(agent.environment)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
        </div>
      </div>

      {/* ---- Addon: Plus menu dropdown — rendered fixed to escape input overflow ---- */}
      {showPlusMenu && (
        <div
          data-plus-menu
          className="fixed z-[100] min-w-[220px] rounded-xl border border-border bg-popover p-1 shadow-lg"
          style={{ bottom: plusMenuPos.bottom, left: plusMenuPos.left }}
        >
          <button
            onClick={() => {
              setShowPlusMenu(false);
              setImageMode(true);
              setIsCanvasEnabled(false);
            }}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm text-foreground hover:bg-accent"
          >
            <div className="flex items-center gap-3">
              <Paintbrush size={16} className={imageMode ? "text-red-500" : "text-muted-foreground"} />
              <span>{t("Create image")}</span>
            </div>
            {imageMode && (
              <span className="text-xs font-medium text-red-500">ON</span>
            )}
          </button>
          <button
            onClick={() => {
              setShowPlusMenu(false);
              setIsCanvasEnabled(!isCanvasEnabled);
            }}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm text-foreground hover:bg-accent"
          >
            <div className="flex items-center gap-3">
              <BookOpen size={16} className={isCanvasEnabled ? "text-red-500" : "text-muted-foreground"} />
              <span>{t("Canvas")}</span>
            </div>
            {isCanvasEnabled && (
              <span className="text-xs font-medium text-red-500">ON</span>
            )}
          </button>
          <button
            onClick={() => {
              setShowPlusMenu(false);
              fileInputRef.current?.click();
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-foreground hover:bg-accent"
          >
            <Upload size={16} className="text-muted-foreground" />
            <span>{t("Upload from this device")}</span>
          </button>
          <button
            onClick={() => {
              setShowPlusMenu(false);
              setSpPickerOpen(true);
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-foreground hover:bg-accent"
          >
            <FileUp size={16} className="text-green-500" />
            <span>{t("Upload from SharePoint")}</span>
          </button>
          
          <div className="my-1 h-px bg-border" />
          {(() => {
            const selectedModel = noAgentMode && selectedAiModel ? aiModels.find((m) => m.id === selectedAiModel) : null;
            // Restrict COT to Gemini models only (the only provider with reliable
            // visible thinking support in our current setup). Matches names like
            // "Gemini 3 Pro", "gemini-3.1-pro-preview", "Google 3.1 Pro", "Gemini 2.5 Flash".
            const modelName = `${selectedModel?.name || ""}`.toLowerCase();
            const isGeminiModel = /\b(gemini|google)\b/.test(modelName) && /\b(2\.5|3|3\.\d+)\b/.test(modelName);
            const cotDisabled = noAgentMode && !isGeminiModel;
            return (
          <button
            onClick={() => { if (!cotDisabled) setCotReasoning(!cotReasoning); }}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm ${
              cotDisabled ? "cursor-not-allowed text-muted-foreground/50" : "text-foreground hover:bg-accent"
            }`}
            title={cotDisabled ? "Selected model does not support reasoning" : undefined}
          >
            <div className="flex items-center gap-3">
              <Lightbulb size={16} className={cotDisabled ? "text-muted-foreground/30" : "text-muted-foreground"} />
              <span>{t("COT reasoning")}</span>
              {cotDisabled && noAgentMode && selectedModel && (
                <span className="text-xxs text-muted-foreground/50">({t("not supported")})</span>
              )}
            </div>
            <div
              className={`relative h-5 w-9 rounded-full transition-colors ${
                cotDisabled ? "bg-muted-foreground/10" : cotReasoning ? "bg-primary" : "bg-muted-foreground/30"
              }`}
            >
              <div
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${cotReasoning ? "translate-x-4" : "translate-x-0.5"}`}
              />
            </div>
          </button>
            );
          })()}
        </div>
      )}

      {/* Three-dot chat menu dropdown — rendered fixed to escape scroll container */}
      {chatMenuOpenId && (
        <div
          data-chat-menu
          className="fixed z-[100] min-w-[140px] rounded-lg border border-border bg-popover p-1 shadow-lg"
          style={{ top: chatMenuPos.top, left: chatMenuPos.left }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              const sessionId = chatMenuOpenId;
              setChatMenuOpenId(null);
              handleDeleteSession(sessionId);
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-red-500 hover:bg-accent"
          >
            <Trash2 size={14} />
            <span>{t("Delete")}</span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setChatMenuOpenId(null);
              handleArchiveSession(chatMenuOpenId!, true);
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-accent"
          >
            <Archive size={14} />
            <span>{t("Archive")}</span>
          </button>
        </div>
      )}

      {/* ================ MAIN AREA ================ */}
      {showNotebookLM ? (
        /* ---- NotebookLM panel (inline, like image gallery) ---- */
        <NotebookLMPanel onBack={() => setShowNotebookLM(false)} />
      ) : showImageGallery ? (
        /* ---- Image Gallery View ---- */
        <ImageGalleryView
          onBack={() => setShowImageGallery(false)}
          selectedImage={selectedGalleryImage}
          onSelectImage={setSelectedGalleryImage}
          onClosePreview={() => setSelectedGalleryImage(null)}
        />
      ) : (
      <div className="relative flex flex-1 flex-col">
        {/* Top Bar */}
        <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-4">
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="flex items-center rounded-md p-1.5 text-muted-foreground hover:bg-accent"
            >
              <PanelLeft size={18} />
            </button>
          )}

          {/* Agent selector */}
          <div ref={modelPickerRef} className="relative">
            <button
              onClick={() => setShowModelPicker(!showModelPicker)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[15px] font-semibold text-foreground hover:bg-accent"
            >
              <Sparkles size={16} style={{ color: noAgentMode ? "#6b7280" : (selectedAgent?.color || "#10a37f") }} />
              {noAgentMode ? (
                <span className="text-muted-foreground">{t("No Agent")}</span>
              ) : selectedAgent ? (
                <span className="flex items-center">
                  <span>{selectedAgent.name}</span>
                  {versionBadge(selectedAgent.version_label)}
                  {uatBadge(selectedAgent.environment)}
                </span>
              ) : (
                t("Select Agent")
              )}
              <ChevronDown size={14} className="opacity-50" />
            </button>

            {showModelPicker && (
              <div className="absolute left-0 top-full z-50 mt-1 min-w-[240px] rounded-xl border border-border bg-popover p-1 shadow-lg">
                {/* No Agent option */}
                <button
                  onClick={() => {
                    setNoAgentMode(true);
                    setSelectedModelId("");
                    setShowModelPicker(false);
                    if (!selectedAiModel) {
                      const defaultModel = aiModels.find((m) => m.is_default) || aiModels[0];
                      if (defaultModel) setSelectedAiModel(defaultModel.id);
                    }
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-foreground hover:bg-accent ${
                    noAgentMode ? "bg-accent" : ""
                  }`}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
                    <User size={14} className="text-muted-foreground" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{t("No Agent")}</div>
                    <div className="text-xs text-muted-foreground">{t("Chat with AI model directly")}</div>
                  </div>
                  {noAgentMode && (
                    <span className="ml-auto text-primary"><Check size={14} /></span>
                  )}
                </button>
                <div className="my-1 h-px bg-border" />
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => {
                      setSelectedModelId(agent.id);
                      setNoAgentMode(false);
                      setSelectedAiModel(null);
                      setShowModelPicker(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-foreground hover:bg-accent ${
                      !noAgentMode && selectedModelId === agent.id ? "bg-accent" : ""
                    }`}
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                      style={{ background: agent.color }}
                    >
                      <Sparkles size={14} color="white" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center font-medium">
                        <span>{agent.name}</span>
                        {versionBadge(agent.version_label)}
                        {uatBadge(agent.environment)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {agent.description}
                      </div>
                    </div>
                    {!noAgentMode && selectedModelId === agent.id && (
                      <span className="ml-auto text-primary">
                        <Check size={14} />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ---- Addon: AI Model selector (beside agent dropdown) ---- */}
          <div ref={aiModelPickerRef} className="relative">
            <button
              onClick={() => {
                setShowAiModelPicker(!showAiModelPicker);
                setShowMoreModels(false);
              }}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[15px] font-semibold hover:bg-accent ${
                noAgentMode ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {noAgentMode && selectedAiModel && aiModels.find((m) => m.id === selectedAiModel)?.icon ? (
                <img
                  src={aiModels.find((m) => m.id === selectedAiModel)!.icon}
                  alt=""
                  className="h-4 w-4 shrink-0 object-contain"
                />
              ) : (
                <span className="h-3 w-3 shrink-0 rounded-full bg-muted-foreground/40" />
              )}
              <span>{noAgentMode && selectedAiModel ? aiModels.find((m) => m.id === selectedAiModel)?.name || t("Choose AI Model") : t("Choose AI Model")}</span>
              <ChevronDown size={14} className="opacity-50" />
            </button>

            {showAiModelPicker && (
              <div className="absolute left-0 top-full z-50 mt-1 min-w-[220px] rounded-xl border border-border bg-popover p-1 shadow-lg">
                <div className="px-3 pb-1 pt-2 text-xxs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("Choose Your AI Model")}
                </div>
                {aiModels.filter((m) => m.group === "main").map((model) => (
                  <button
                    key={model.id}
                    disabled={!noAgentMode}
                    onClick={() => {
                      if (!noAgentMode) return;
                      setSelectedAiModel(model.id);
                      setShowAiModelPicker(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm ${
                      !noAgentMode
                        ? "cursor-not-allowed text-muted-foreground/50"
                        : selectedAiModel === model.id
                          ? "bg-accent text-foreground"
                          : "text-foreground hover:bg-accent"
                    }`}
                  >
                    <img
                      src={model.icon}
                      alt=""
                      className={`h-5 w-5 shrink-0 object-contain ${!noAgentMode ? "opacity-30" : ""}`}
                    />
                    <span className="flex-1">{model.name}</span>
                    {noAgentMode && selectedAiModel === model.id && (
                      <Check size={14} className="text-primary" />
                    )}
                  </button>
                ))}
                {/* More submenu — only show if there are "more" models */}
                {aiModels.some((m) => m.group === "more") && <div className="relative">
                  <button
                    disabled={!noAgentMode}
                    onClick={() => {
                      if (!noAgentMode) return;
                      setShowMoreModels(!showMoreModels);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm ${
                      !noAgentMode
                        ? "cursor-not-allowed text-muted-foreground/50"
                        : "text-foreground hover:bg-accent"
                    }`}
                  >
                    <MoreVertical size={14} className={!noAgentMode ? "opacity-30" : ""} />
                    <span className="flex-1">{t("More")}</span>
                    <ChevronRight size={14} className="opacity-50" />
                  </button>
                  {showMoreModels && noAgentMode && (
                    <div className="absolute left-full top-0 z-50 ml-1 min-w-[180px] rounded-xl border border-border bg-popover p-1 shadow-lg">
                      {aiModels.filter((m) => m.group === "more").map((model) => (
                        <button
                          key={model.id}
                          onClick={() => {
                            setSelectedAiModel(model.id);
                            setShowAiModelPicker(false);
                            setShowMoreModels(false);
                          }}
                          className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm ${
                            selectedAiModel === model.id
                              ? "bg-accent text-foreground"
                              : "text-foreground hover:bg-accent"
                          }`}
                        >
                          <img
                            src={model.icon}
                            alt=""
                            className="h-5 w-5 shrink-0 object-contain"
                          />
                          <span className="flex-1">{model.name}</span>
                          {selectedAiModel === model.id && (
                            <Check size={14} className="text-primary" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>}
              </div>
            )}
          </div>
        </div>

        {/* ================ MESSAGES ================ */}
        <div className="flex flex-1 flex-col items-center overflow-y-auto">
          <div className="w-full max-w-3xl px-6 pb-44 pt-6">
            {messages.map((msg, idx) => {
              // Context reset divider
              if (msg.category === "context_reset") {
                return (
                  <div key={msg.id} className="flex items-center gap-3 py-4">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-xs font-medium text-muted-foreground">
                      {msg.content}
                    </span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                );
              }

              const isUser = msg.sender === "user";
              const isThinking = msg.sender === "agent" && msg.content === "" && isSending;

              // Canvas: any agent message can be edited via canvas
              const isEditingThis = canvasEditingId === msg.id;
              const hasFollowupAgentReply = messages
                .slice(idx + 1)
                .some(
                  (nextMsg) =>
                    nextMsg.sender === "agent" &&
                    !nextMsg.hitl &&
                    (!!nextMsg.content?.trim() || !!nextMsg.contentBlocks?.length),
                );
              const explicitHitlStatus = hitlDoneMap[msg.id];
              const hitlResolved = msg.hitlIsDeployed
                ? !!explicitHitlStatus
                : (!!explicitHitlStatus || hasFollowupAgentReply);
              const resolvedLabel = explicitHitlStatus || (!msg.hitlIsDeployed && hasFollowupAgentReply ? "Completed" : "");
              const isRejectedResolution = resolvedLabel.toLowerCase().includes("reject");
              return (
                <div key={msg.id} className="flex items-start gap-4 py-5">
                  {/* Avatar */}
                  <div
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center ${
                      isUser ? "rounded-full bg-muted" : "rounded-lg"
                    }`}
                    style={!isUser ? { background: getAgentColor(msg.agentName) } : undefined}
                  >
                    {isUser ? (
                      <User size={16} className="text-muted-foreground" />
                    ) : (
                      <Sparkles size={16} color="white" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
                      {isUser ? t("You") : msg.agentName}
                      <span className="text-xs font-normal text-muted-foreground">
                        {msg.timestamp}
                      </span>
                    </div>
                    {isThinking ? (
                      <div className="flex items-center gap-2">
                        <Loader2 size={16} className="animate-spin text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">{t("Thinking...")}</span>
                      </div>
                    ) : isUser ? (
                      <div className="text-[15px] leading-relaxed text-foreground/80">
                        {highlightMentions(msg.content)}
                        {msg.files && msg.files.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {msg.files.map((filePath, idx) => {
                              const ext = filePath.split(".").pop()?.toLowerCase() || "";
                              const isImage = ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext);
                              const fileName = filePath.split("/").pop() || filePath;
                              return isImage ? (
                                <img
                                  key={idx}
                                  src={`${BASE_URL_API}files/images/${filePath}`}
                                  alt="uploaded"
                                  className="max-h-48 max-w-xs rounded-lg border border-border object-contain"
                                />
                              ) : (
                                <div
                                  key={idx}
                                  className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
                                >
                                  <FileText size={16} />
                                  <span className="max-w-[200px] truncate" title={fileName}>{fileName}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-[15px] leading-relaxed text-foreground/80">
                        {/* CoT Reasoning — MiBuddy-style pill + collapsible panel */}
                        {msg.reasoningContent && (
                          <details className="mb-3 group" open={isSending && msg.id === streamingMsgId}>
                            <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full border border-border bg-muted/50 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted [&::-webkit-details-marker]:hidden">
                              <Lightbulb size={16} className="text-yellow-500" />
                              <span>{t("Reasoning")}</span>
                              {isSending && msg.id === streamingMsgId && (
                                <Loader2 size={12} className="animate-spin text-muted-foreground" />
                              )}
                              <ChevronDown size={14} className="text-muted-foreground transition-transform group-open:rotate-180" />
                            </summary>
                            <div className="mt-3 whitespace-pre-wrap rounded-lg border border-border bg-muted/20 p-4 text-sm leading-relaxed text-muted-foreground">
                              {msg.reasoningContent}
                            </div>
                          </details>
                        )}
                        {msg.contentBlocks && msg.contentBlocks.length > 0 && (
                          <ContentBlockDisplay
                            contentBlocks={msg.contentBlocks}
                            chatId={msg.id}
                            state={msg.blocksState}
                            isLoading={isSending && msg.id === streamingMsgId}
                          />
                        )}
                        <MarkdownField
                          chat={{}}
                          isEmpty={!msg.content}
                          chatMessage={msg.content}
                          editedFlag={null}
                        />
                        {/* Action buttons row — hide when message contains a generated image */}
                        {msg.content && !isSending && !/!\[.*?\]\(.*?\)/.test(msg.content) && (
                          <div className="mt-1.5 flex items-center gap-1">
                            <button
                              onClick={() => handleCopyMessage(msg.content, msg.id)}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                              title={copiedMsgId === msg.id ? t("Copied!") : t("Copy")}
                            >
                              {copiedMsgId === msg.id ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
                            </button>
                            <button
                              onClick={() => handleSpeak(msg.content)}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                              title={t("Read aloud")}
                            >
                              <AudioLines size={13} />
                            </button>
                            <div className="relative" data-export-menu>
                              <button
                                onClick={() => setExportMenuOpenId(exportMenuOpenId === msg.id ? null : msg.id)}
                                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                                title={t("Export")}
                              >
                                <Download size={13} />
                              </button>
                              {exportMenuOpenId === msg.id && (
                                <div className="absolute left-0 top-full z-50 mt-1 min-w-[140px] rounded-lg border border-border bg-popover p-1 shadow-lg">
                                  <button
                                    onClick={() => { handleExportDocx(msg.content); setExportMenuOpenId(null); }}
                                    className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-foreground hover:bg-accent"
                                  >
                                    <FileText size={14} className="text-blue-600" />
                                    <span>{t("Word")}</span>
                                  </button>
                                  <button
                                    onClick={() => { handleExportPdf(msg.content); setExportMenuOpenId(null); }}
                                    className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-foreground hover:bg-accent"
                                  >
                                    <FileText size={14} className="text-red-600" />
                                    <span>{t("PDF")}</span>
                                  </button>
                                  <button
                                    onClick={() => { handleExportText(msg.content); setExportMenuOpenId(null); }}
                                    className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-foreground hover:bg-accent"
                                  >
                                    <File size={14} className="text-muted-foreground" />
                                    <span>{t("Text")}</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        {/* HITL action buttons */}
                        {msg.hitl && (
                          msg.hitlIsDeployed ? (
                            /* Deployed runs: approval goes to dept admin via HITL page */
                            hitlResolved ? (
                              <div
                                className={[
                                  "mt-3 flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm",
                                  isRejectedResolution
                                    ? "border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950/30 dark:text-red-300"
                                    : "border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950/30 dark:text-green-300",
                                ].join(" ")}
                              >
                                <span className="font-medium">Human review status:</span>
                                <span>{resolvedLabel}</span>
                              </div>
                            ) : (
                              <div className="mt-3 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm dark:border-amber-700 dark:bg-amber-950/30">
                                <Clock size={16} className="shrink-0 text-amber-600 dark:text-amber-400" />
                                <span className="text-amber-700 dark:text-amber-300">
                                  Pending department admin approval. The assigned admin can approve or reject from the{" "}
                                  <a
                                    href="/hitl-approvals"
                                    className="font-medium underline hover:text-amber-900 dark:hover:text-amber-100"
                                  >
                                    HITL Approvals
                                  </a>{" "}
                                  page.
                                </span>
                              </div>
                            )
                          ) : (
                          (msg.hitlActions && msg.hitlActions.length > 0) ? (
                          <div className="mt-3 flex flex-col gap-2.5">
                            <div className="flex flex-wrap gap-2">
                            {msg.hitlActions.map((action) => {
                              const done = hitlDoneMap[msg.id];
                              const isLoading = hitlLoadingId === msg.id;
                              const isThisAction = hitlLoadingAction === action;
                              const isReject = action.toLowerCase().includes("reject");
                              return (
                                <button
                                  key={action}
                                  onClick={() =>
                                    handleHitlAction(msg.id, msg.hitlThreadId ?? "", action)
                                  }
                                  disabled={!!done || isLoading}
                                  className={[
                                    "inline-flex items-center gap-1.5 rounded-md border px-4 py-1.5 text-sm font-medium transition-colors",
                                    done === action
                                      ? isReject
                                        ? "border-red-500 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                                        : "border-green-500 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                                      : done
                                        ? "cursor-not-allowed border-border bg-muted/30 text-muted-foreground opacity-50"
                                        : isLoading && isThisAction
                                          ? isReject
                                            ? "cursor-wait border-red-400 bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                                            : "cursor-wait border-green-400 bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400"
                                          : isLoading
                                            ? "cursor-not-allowed border-border bg-muted/30 text-muted-foreground opacity-50"
                                            : isReject
                                              ? "cursor-pointer border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/30"
                                              : "cursor-pointer border-border text-foreground hover:bg-muted",
                                  ].join(" ")}
                                >
                                  {isLoading && isThisAction && (
                                    <Loader2 size={14} className="animate-spin" />
                                  )}
                                  {isLoading && isThisAction
                                    ? "Submitting..."
                                    : done === action
                                      ? `\u2713 ${action}`
                                      : action}
                                </button>
                              );
                            })}
                            </div>
                            {hitlDoneMap[msg.id] && (
                              <span className="text-xs text-muted-foreground">
                                Decision submitted — agent continued.
                              </span>
                            )}
                          </div>
                          ) : null
                          )
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* ================ INPUT AREA ================ */}
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex justify-center bg-gradient-to-t from-background from-40% to-transparent px-6 pb-6">
          <div className="pointer-events-auto relative w-full max-w-3xl">
            {/* Mention dropdown */}
            {showMentions && (
              <div className="absolute bottom-full left-0 z-50 mb-2 max-h-64 min-w-[240px] overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg">
                {filteredAgents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => handleSelectAgent(agent)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-foreground hover:bg-accent"
                  >
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                      style={{ background: agent.color }}
                    >
                      <Sparkles size={12} color="white" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center font-medium">
                        <span>@{agent.name}</span>
                        {versionBadge(agent.version_label)}
                        {uatBadge(agent.environment)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {agent.description}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Text Input */}
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              {/* File previews */}
              {uploadFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 px-4 pt-3">
                  {uploadFiles.map((f) => (
                    <div
                      key={f.id}
                      className="relative flex items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xs"
                    >
                      {f.loading ? (
                        <Loader2 size={14} className="animate-spin text-muted-foreground" />
                      ) : f.error ? (
                        <span className="text-destructive">Failed</span>
                      ) : ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(
                          f.file.name.split(".").pop()?.toLowerCase() || ""
                        ) ? (
                        <ImagePlus size={14} className="text-muted-foreground" />
                      ) : (
                        <FileText size={14} className="text-muted-foreground" />
                      )}
                      <span className="max-w-[120px] truncate">{f.file.name}</span>
                      <button
                        onClick={() => removeFile(f.id)}
                        className="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {/* Autocomplete suggestions dropdown */}
              {showSuggestions && suggestions.length > 0 && noAgentMode && (
                <div className="border-b border-border px-2 py-1.5">
                  {suggestions.map((s, i) => (
                    <div
                      key={i}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectSuggestion(s);
                      }}
                      className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
                        i === selectedSuggestionIdx
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      <Search size={12} className="shrink-0 opacity-50" />
                      <span className="truncate">{s}</span>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                onPaste={handlePaste}
                disabled={isSending || !canInteract}
                onKeyDown={(e) => {
                  // Suggestion keyboard navigation
                  if (showSuggestions && suggestions.length > 0) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setSelectedSuggestionIdx((prev) => (prev + 1) % suggestions.length);
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setSelectedSuggestionIdx((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
                      return;
                    }
                    if (e.key === "Enter" && !e.shiftKey && selectedSuggestionIdx >= 0) {
                      e.preventDefault();
                      handleSelectSuggestion(suggestions[selectedSuggestionIdx]);
                      return;
                    }
                    if (e.key === "Escape") {
                      setSuggestions([]);
                      setShowSuggestions(false);
                      return;
                    }
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    setSuggestions([]); setShowSuggestions(false);
                    handleSend();
                  }
                }}
                placeholder={
                  !canInteract
                    ? t("You do not have permission to interact with agents.")
                    : isSending
                      ? t("Waiting for response...")
                      : t("Message agents or type @ to mention...")
                }
                rows={1}
                className={`w-full resize-none border-none bg-transparent px-5 py-4 pr-14 text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0 ${(isSending || !canInteract) ? "cursor-not-allowed opacity-50" : ""}`}
              />
              {/* Canvas indicator pill */}
              {isCanvasEnabled && (
                <div className="flex items-center px-4 pb-1">
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 dark:border-red-800 dark:bg-red-950/30">
                    <Pencil size={12} className="text-red-500" />
                    <span className="text-xs font-semibold text-red-500">{t("Canvas")}</span>
                    <button
                      onClick={() => setIsCanvasEnabled(false)}
                      className="ml-0.5 rounded-full p-0.5 text-red-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/50"
                    >
                      <X size={10} />
                    </button>
                  </div>
                </div>
              )}
              {/* Image mode indicator pill */}
              {imageMode && (
                <div className="flex items-center px-4 pb-1">
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 dark:border-red-800 dark:bg-red-950/30">
                    <Image size={12} className="text-red-500" />
                    <span className="text-xs font-semibold text-red-500">{t("Image")}</span>
                    <button
                      onClick={() => setImageMode(false)}
                      className="ml-0.5 rounded-full p-0.5 text-red-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/50"
                    >
                      <X size={10} />
                    </button>
                  </div>
                </div>
              )}
              {/* COT reasoning pill */}
              {cotReasoning && (
                <div className="flex items-center px-4 pb-1">
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 dark:border-red-800 dark:bg-red-950/30">
                    <Lightbulb size={12} className="text-red-500" />
                    <span className="text-xs font-semibold text-red-500">{t("COT")}</span>
                    <button
                      onClick={() => setCotReasoning(false)}
                      className="ml-0.5 rounded-full p-0.5 text-red-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/50"
                    >
                      <X size={10} />
                    </button>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between px-3 pb-3">
                <div className="flex items-center gap-1">
                  {/* ---- Addon: Plus menu button ---- */}
                  <div data-plus-menu>
                    <button
                      onClick={(e) => {
                        if (!showPlusMenu) {
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setPlusMenuPos({ bottom: window.innerHeight - rect.top + 8, left: rect.left });
                        }
                        setShowPlusMenu(!showPlusMenu);
                      }}
                      disabled={isSending || !canInteract}
                      className={`flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors ${(isSending || !canInteract) ? "cursor-not-allowed opacity-50" : "hover:bg-accent hover:text-foreground"}`}
                      title={t("More options")}
                    >
                      <Plus size={16} />
                    </button>
                  </div>

                  {/* Existing: Upload image button */}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isSending || !canInteract}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors ${(isSending || !canInteract) ? "cursor-not-allowed opacity-50" : "hover:bg-accent hover:text-foreground"}`}
                    title={t("Upload image")}
                  >
                    <ImagePlus size={16} />
                  </button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",")}
                  className="hidden"
                  onChange={handleFileChange}
                />
                <div className="flex items-center gap-1">
                  {/* ---- Addon: Microphone button (Speech-to-Text) ---- */}
                  <button
                    onClick={handleMicClick}
                    disabled={isSending || !canInteract}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                      isListening
                        ? "bg-red-500 text-white animate-pulse"
                        : (isSending || !canInteract)
                          ? "cursor-not-allowed text-muted-foreground opacity-50"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                    title={isListening ? t("Stop listening") : t("Voice input")}
                  >
                    {isListening ? <AudioLines size={16} /> : <Mic size={16} />}
                  </button>
                  {/* Existing: Send button */}
                  <button
                    onClick={handleSend}
                    disabled={(!input.trim() && !uploadFiles.some((f) => f.path)) || isSending || !canInteract}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                      (input.trim() || uploadFiles.some((f) => f.path)) && !isSending && canInteract
                        ? "bg-foreground text-background hover:opacity-90"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <Send size={16} className="-ml-px -mt-px" />
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-2 text-center text-xs text-muted-foreground">
              {t("Agents can make mistakes. Review important info.")}
            </div>
          </div>
        </div>
      </div>
      )}
      {/* ---- Addon: SharePoint File Picker (MSAL-based) ---- */}
      <SharePointFilePicker
        isOpen={spPickerOpen}
        onDismiss={() => setSpPickerOpen(false)}
        onFilesSelected={handleSpFilesSelected}
      />
      {/* ---- Addon: Outlook Connector ---- */}
      <OutlookConnector
        isOpen={outlookDialogOpen}
        onDismiss={() => setOutlookDialogOpen(false)}
        onConnected={() => {
          setOutlookConnected(true);
        }}
        onDisconnected={() => {
          setOutlookConnected(false);
          refreshOutlookStatus();
        }}
      />
      {false && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50">
          <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-popover shadow-2xl">
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-3">
                {!spShowConsent && spFolderStack.length > 0 && (
                  <button
                    onClick={spGoBack}
                    className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <ArrowLeft size={18} />
                  </button>
                )}
                <div>
                  <h2 className="text-base font-semibold text-foreground">
                    {spShowConsent ? t("Connect to SharePoint") : t("SharePoint Files")}
                  </h2>
                  {!spShowConsent && spFolderStack.length > 0 && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span>{t("OneDrive")}</span>
                      {spFolderStack.map((f) => (
                        <span key={f.id}>
                          <span className="mx-0.5">/</span>
                          <span>{f.name}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <button
                onClick={() => { setSpModalOpen(false); setSpShowConsent(false); }}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X size={18} />
              </button>
            </div>

            {spShowConsent ? (
              <div className="flex flex-1 flex-col px-6 py-6">
                <div className="mb-5 flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-900/30">
                    <Shield size={24} className="text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{t("Permissions Required")}</h3>
                    <p className="text-xs text-muted-foreground">{t("This app needs access to your Microsoft account")}</p>
                  </div>
                </div>

                <p className="mb-4 text-sm text-muted-foreground">
                  {t("To browse and upload files from SharePoint, the following permissions are required:")}
                </p>

                <div className="mb-6 flex flex-col gap-3">
                  <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-500" />
                    <div>
                      <div className="text-sm font-medium text-foreground">{t("Read your profile")}</div>
                      <div className="text-xs text-muted-foreground">{t("View your basic account information")}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-500" />
                    <div>
                      <div className="text-sm font-medium text-foreground">{t("Access your files")}</div>
                      <div className="text-xs text-muted-foreground">{t("Read files from your OneDrive and SharePoint")}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-500" />
                    <div>
                      <div className="text-sm font-medium text-foreground">{t("Access SharePoint sites")}</div>
                      <div className="text-xs text-muted-foreground">{t("Browse SharePoint sites you have access to")}</div>
                    </div>
                  </div>
                </div>

                {spError && (
                  <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-950/30 dark:text-red-300">
                    {spError}
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => { setSpModalOpen(false); setSpShowConsent(false); }}
                    className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-accent"
                  >
                    {t("Cancel")}
                  </button>
                  <button
                    onClick={handleSharePointConsent}
                    disabled={spLoading}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {spLoading ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        {t("Connecting...")}
                      </>
                    ) : (
                      t("Allow & Connect")
                    )}
                  </button>
                </div>

                <p className="mt-4 text-center text-xs text-muted-foreground">
                  {t("You will be redirected to Microsoft to sign in and grant access.")}
                </p>
              </div>
            ) : (
            <div className="flex-1 overflow-y-auto px-2 py-2" style={{ scrollbarWidth: "thin" }}>
              {spError && (
                <div className="mx-3 mb-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-950/30 dark:text-red-300">
                  {spError}
                  {!spAccessToken && (
                    <button
                      onClick={handleSharePointAuth}
                      className="ml-2 font-medium underline"
                    >
                      {t("Try again")}
                    </button>
                  )}
                </div>
              )}

              {spLoading && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-muted-foreground" />
                  <span className="ml-3 text-sm text-muted-foreground">{t("Loading...")}</span>
                </div>
              )}

              {!spLoading && !spError && spItems.length === 0 && spAccessToken && (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  {t("No files found in this location")}
                </div>
              )}

              {!spLoading && spItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    if (item.type === "folder") {
                      spOpenFolder(item);
                    } else {
                      spSelectFile(item);
                    }
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm text-foreground hover:bg-accent"
                >
                  {item.type === "folder" ? (
                    <Folder size={20} className="shrink-0 text-blue-500" />
                  ) : (
                    <File size={20} className="shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{item.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.type === "folder"
                        ? `${item.childCount ?? 0} items`
                        : item.size
                          ? `${(item.size / 1024).toFixed(1)} KB`
                          : ""}
                    </div>
                  </div>
                  {item.type === "folder" && (
                    <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
                  )}
                </button>
              ))}
            </div>
            )}

            {/* Modal footer */}
            <div className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
              {!spShowConsent && spAccessToken
                ? t("Click a file to attach it, or open a folder to browse")
                : t("Authenticate with your Microsoft account to browse files")}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
