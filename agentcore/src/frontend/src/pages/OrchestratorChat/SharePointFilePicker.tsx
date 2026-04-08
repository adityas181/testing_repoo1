import { useState, useEffect } from "react";
import { useMsal } from "@azure/msal-react";
import { Client, ResponseType } from "@microsoft/microsoft-graph-client";
import {
  Loader2,
  Folder,
  File as FileIcon,
  FileText,
  FileSpreadsheet,
  FileImage,
  ChevronRight,
  X,
  ArrowLeft,
  Check,
} from "lucide-react";
import { useTranslation } from "react-i18next";

/* SharePoint scopes — broader than the default login scopes */
const sharepointLoginRequest = {
  scopes: ["User.Read", "Files.Read.All", "Sites.Read.All"],
};

interface DriveItem {
  id: string;
  name: string;
  folder?: any;
  file?: { mimeType?: string };
  size?: number;
  webUrl: string;
  parentReference?: { driveId: string; id: string };
}

interface SharePointFilePickerProps {
  isOpen: boolean;
  onDismiss: () => void;
  onFilesSelected: (files: File[]) => void;
}

export default function SharePointFilePicker({
  isOpen,
  onDismiss,
  onFilesSelected,
}: SharePointFilePickerProps) {
  const { t } = useTranslation();
  const { instance, accounts } = useMsal();
  const [items, setItems] = useState<DriveItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [folderStack, setFolderStack] = useState<
    { id: string; name: string }[]
  >([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // Whether the user has granted SharePoint consent this session
  const [spConsented, setSpConsented] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setFolderStack([]);
      setSelectedIds(new Set());
      setError(null);
      setItems([]);
      // Don't reset spConsented — keep it across open/close within same session
    }
  }, [isOpen]);

  // If already consented and modal opens, fetch files immediately
  useEffect(() => {
    if (isOpen && spConsented) {
      fetchFiles("root");
    }
  }, [isOpen, spConsented]);

  /* ── MSAL helpers ─────────────────────────────────────────────── */

  const handleAcceptAndContinue = async () => {
    setLoading(true);
    setError(null);
    try {
      // If not logged in at all, do a full login popup
      if (accounts.length === 0) {
        await instance.loginPopup(sharepointLoginRequest);
      } else {
        // Already logged in — acquire token with SharePoint scopes
        // This may trigger a consent popup from Microsoft if not yet consented
        try {
          await instance.acquireTokenSilent({
            ...sharepointLoginRequest,
            account: accounts[0],
          });
        } catch {
          // Silent failed — show popup for consent
          await instance.acquireTokenPopup({
            ...sharepointLoginRequest,
            account: accounts[0],
          });
        }
      }
      setSpConsented(true);
      await fetchFiles("root");
    } catch (e) {
      console.error("SharePoint login failed:", e);
      setError("Authentication failed. Please try again.");
      setLoading(false);
    }
  };

  const getGraphClient = async (): Promise<Client> => {
    const request = { ...sharepointLoginRequest, account: accounts[0] };
    try {
      const response = await instance.acquireTokenSilent(request);
      return Client.init({
        authProvider: (done) => done(null, response.accessToken),
      });
    } catch {
      const response = await instance.acquireTokenPopup(request);
      return Client.init({
        authProvider: (done) => done(null, response.accessToken),
      });
    }
  };

  /* ── Data fetching ────────────────────────────────────────────── */

  const fetchFiles = async (folderId: string) => {
    setLoading(true);
    setError(null);
    try {
      const client = await getGraphClient();
      const path =
        folderId === "root"
          ? "/me/drive/root/children"
          : `/me/drive/items/${folderId}/children`;
      const response = await client.api(path).get();
      setItems(response.value || []);
      setSelectedIds(new Set());
    } catch (err) {
      console.error("Error fetching files:", err);
      setError("Failed to load files");
    } finally {
      setLoading(false);
    }
  };

  /* ── Interactions ─────────────────────────────────────────────── */

  const openFolder = (item: DriveItem) => {
    setFolderStack((prev) => [...prev, { id: item.id, name: item.name }]);
    fetchFiles(item.id);
  };

  const goBack = () => {
    const newStack = [...folderStack];
    newStack.pop();
    setFolderStack(newStack);
    const parentId =
      newStack.length > 0 ? newStack[newStack.length - 1].id : "root";
    fetchFiles(parentId);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleItemClick = (item: DriveItem) => {
    if (item.folder) {
      openFolder(item);
    } else {
      toggleSelect(item.id);
    }
  };

  const handleDownloadSelected = async () => {
    if (selectedIds.size === 0) return;
    setLoading(true);
    try {
      const client = await getGraphClient();
      const filesToDownload = items.filter(
        (f) => selectedIds.has(f.id) && !f.folder,
      );
      const downloaded: File[] = [];

      for (const item of filesToDownload) {
        try {
          const blob = await client
            .api(`/me/drive/items/${item.id}/content`)
            .responseType(ResponseType.BLOB)
            .get();
          downloaded.push(new File([blob], item.name, { type: blob.type }));
        } catch (err) {
          console.error(`Failed to download ${item.name}:`, err);
        }
      }

      onFilesSelected(downloaded);
      onDismiss();
    } catch (err) {
      console.error("Download error:", err);
      setError("Failed to download files");
    } finally {
      setLoading(false);
    }
  };

  /* ── File icon helper ─────────────────────────────────────────── */

  const ItemIcon = ({ item }: { item: DriveItem }) => {
    if (item.folder) return <Folder size={20} className="shrink-0 text-blue-500" />;
    const ext = item.name.split(".").pop()?.toLowerCase();
    if (["jpg", "jpeg", "png", "gif", "bmp", "webp"].includes(ext || ""))
      return <FileImage size={20} className="shrink-0 text-purple-500" />;
    if (["xls", "xlsx", "csv"].includes(ext || ""))
      return <FileSpreadsheet size={20} className="shrink-0 text-green-600" />;
    if (["doc", "docx", "pdf", "txt", "ppt", "pptx"].includes(ext || ""))
      return <FileText size={20} className="shrink-0 text-blue-600" />;
    return <FileIcon size={20} className="shrink-0 text-muted-foreground" />;
  };

  if (!isOpen) return null;

  /* ── Render ───────────────────────────────────────────────────── */

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50">
      <div className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-2xl border border-border bg-popover shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            {spConsented && folderStack.length > 0 && (
              <button
                onClick={goBack}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ArrowLeft size={18} />
              </button>
            )}
            <h2 className="text-base font-semibold text-foreground">
              {spConsented
                ? t("Select a file from SharePoint")
                : t("Permissions Requested")}
            </h2>
          </div>
          <button
            onClick={onDismiss}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X size={18} />
          </button>
        </div>

        {/* Breadcrumb (when logged in) */}
        {spConsented && folderStack.length > 0 && (
          <div className="flex items-center gap-1 border-b border-border bg-muted/30 px-5 py-2 text-xs text-muted-foreground">
            <button
              onClick={() => {
                setFolderStack([]);
                fetchFiles("root");
              }}
              className="hover:text-foreground hover:underline"
            >
              {t("Root")}
            </button>
            {folderStack.map((f) => (
              <span key={f.id} className="flex items-center gap-1">
                <ChevronRight size={12} />
                <span>{f.name}</span>
              </span>
            ))}
          </div>
        )}

        {/* Body */}
        {!spConsented ? (
          /* ── Consent screen (matching template) ── */
          <div className="flex flex-1 flex-col items-center px-6 py-8 text-center">
            <div className="mb-4 text-5xl">🔒</div>
            <p className="mb-1 text-lg font-semibold text-foreground">
              {t("MiBuddy SharePoint connector needs your permission")}
            </p>
            <p className="mb-5 text-sm text-muted-foreground">
              {t("To access your SharePoint files, we need you to sign in.")}
            </p>

            <div className="mb-6 w-full rounded-lg border border-border bg-muted/30 px-5 py-4 text-left">
              <p className="mb-3 text-sm font-semibold text-foreground">
                {t("This will allow MiBuddy to:")}
              </p>
              <ul className="flex flex-col gap-3">
                <li className="flex items-center gap-3 text-sm text-foreground">
                  <span className="font-bold text-green-600">✓</span>
                  {t("Sign you in and read your profile")}
                </li>
                <li className="flex items-center gap-3 text-sm text-foreground">
                  <span className="font-bold text-green-600">✓</span>
                  {t("Read your files and folders present in SharePoint")}
                </li>
                <li className="flex items-center gap-3 text-sm text-foreground">
                  <span className="font-bold text-green-600">✓</span>
                  {t("Read items in all site collections")}
                </li>
              </ul>
            </div>

            {error && (
              <div className="mb-4 w-full rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-950/30 dark:text-red-300">
                {error}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handleAcceptAndContinue}
                disabled={loading}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {loading && <Loader2 size={16} className="animate-spin" />}
                {loading ? t("Connecting...") : t("Accept & Continue")}
              </button>
              <button
                onClick={onDismiss}
                className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:bg-accent"
              >
                {t("Cancel")}
              </button>
            </div>
          </div>
        ) : (
          /* ── File browser ── */
          <>
            <div
              className="flex-1 overflow-y-auto"
              style={{ scrollbarWidth: "thin", minHeight: "300px" }}
            >
              {loading ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16">
                  <Loader2 size={28} className="animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {t("Loading your content...")}
                  </span>
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center py-16 text-muted-foreground">
                  <div className="mb-2 text-4xl">📁</div>
                  <span className="text-sm">{t("This folder is empty")}</span>
                </div>
              ) : (
                items.map((item) => {
                  const isSelected = selectedIds.has(item.id);
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleItemClick(item)}
                      className={`flex w-full items-center gap-3 border-b border-border/50 px-5 py-3 text-left transition-colors hover:bg-accent/50 ${
                        isSelected ? "bg-blue-50 dark:bg-blue-950/20" : ""
                      }`}
                    >
                      {/* Checkbox for files, spacer for folders */}
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                        {!item.folder ? (
                          <div
                            className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors ${
                              isSelected
                                ? "border-blue-600 bg-blue-600"
                                : "border-muted-foreground/40"
                            }`}
                          >
                            {isSelected && (
                              <Check size={12} className="text-white" />
                            )}
                          </div>
                        ) : (
                          <span className="w-5" />
                        )}
                      </div>

                      <ItemIcon item={item} />

                      <div className="min-w-0 flex-1">
                        <div
                          className={`truncate text-sm ${
                            item.folder ? "font-semibold" : ""
                          } text-foreground`}
                        >
                          {item.name}
                        </div>
                        {item.size && !item.folder && (
                          <div className="text-xs text-muted-foreground">
                            {(item.size / 1024).toFixed(1)} KB
                          </div>
                        )}
                      </div>

                      {item.folder && (
                        <ChevronRight
                          size={16}
                          className="shrink-0 text-muted-foreground"
                        />
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer with action buttons */}
            <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
              <button
                onClick={onDismiss}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
              >
                {t("Cancel")}
              </button>
              <button
                onClick={handleDownloadSelected}
                disabled={selectedIds.size === 0 || loading}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors ${
                  selectedIds.size > 0 && !loading
                    ? "bg-blue-600 hover:bg-blue-700"
                    : "cursor-not-allowed bg-muted text-muted-foreground"
                }`}
              >
                {loading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  `${t("Select")}${selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}`
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
