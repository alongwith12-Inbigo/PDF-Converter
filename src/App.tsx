import React, { useState, useEffect, useMemo } from "react";
import { 
  Folder, 
  FileText, 
  File, 
  FileCode,
  ArrowLeft, 
  Home, 
  Search, 
  Download, 
  CheckCircle, 
  XCircle, 
  Loader2, 
  LogOut, 
  RefreshCw, 
  ChevronRight,
  AlertCircle,
  Clock,
  Settings,
  HelpCircle,
  FileDown,
  Upload
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { 
  initAuth, 
  googleSignIn, 
  logout, 
  fetchDriveFiles, 
  fetchFolderName,
  downloadDriveFileBlob,
  exportGoogleDocToPdf,
  uploadAndConvertToGoogleDoc,
  deleteDriveFile,
  renameDriveFile,
  DriveFile,
  setAccessToken
} from "./lib/drive";
import { User, onAuthStateChanged } from "firebase/auth";
import { auth } from "./lib/drive";

interface ConversionTask {
  id: string;
  name: string;
  mimeType: string;
  status: "idle" | "downloading" | "uploading" | "converting" | "exporting" | "completed" | "failed";
  progressText: string;
  error?: string;
  pdfUrl?: string;
  localFile?: File;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Files & Folders Browse State
  const [currentFolderId, setCurrentFolderId] = useState<string>("root");
  const [folderPath, setFolderPath] = useState<{ id: string; name: string }[]>([
    { id: "root", name: "내 드라이브" }
  ]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<"all" | "hwp" | "google_doc" | "other">("all");

  // Selection & Actions
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [conversionQueue, setConversionQueue] = useState<ConversionTask[]>([]);
  const [isConverting, setIsConverting] = useState(false);

  // Renaming Batch State
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameProgress, setRenameProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);
  const [renameOnDownload, setRenameOnDownload] = useState(true);
  const [downloadAsZip, setDownloadAsZip] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // Find candidates for renaming: files whose names contain a 5-digit student number but are not already renamed to exactly that number
  const renameCandidates = useMemo(() => {
    return files.filter(file => {
      if (file.mimeType === "application/vnd.google-apps.folder") return false;
      
      const match = file.name.match(/(?<!\d)(\d{5})(?!\d)/);
      if (!match) return false;
      
      const studentNum = match[1];
      const dotIndex = file.name.lastIndexOf(".");
      const nameWithoutExt = dotIndex !== -1 ? file.name.substring(0, dotIndex) : file.name;
      
      return nameWithoutExt.trim() !== studentNum;
    });
  }, [files]);

  // Link Paste & Parsing State
  const [pastedUrl, setPastedUrl] = useState("");
  const [isUrlProcessing, setIsUrlProcessing] = useState(false);

  // UI Settings / Theme
  const [showHelpModal, setShowHelpModal] = useState(false);

  // Helper parser for Google Drive links
  const parsedLink = useMemo(() => {
    const trimmed = pastedUrl.trim();
    if (!trimmed) return null;

    // Folders:
    // https://drive.google.com/drive/folders/...
    const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9-_]{15,})/);
    if (folderMatch) {
      return { type: "folder" as const, id: folderMatch[1] };
    }

    // Open?id=
    const openIdMatch = trimmed.match(/[?&]id=([a-zA-Z0-9-_]{15,})/);
    if (openIdMatch) {
      if (trimmed.includes("folders") || trimmed.includes("drive.google.com/open")) {
        return { type: "folder" as const, id: openIdMatch[1] };
      }
      return { type: "file" as const, id: openIdMatch[1] };
    }

    // Docs:
    // https://docs.google.com/document/d/.../edit
    const docMatch = trimmed.match(/\/document\/d\/([a-zA-Z0-9-_]{15,})/);
    if (docMatch) {
      return { type: "document" as const, id: docMatch[1] };
    }

    // Sheets:
    // https://docs.google.com/spreadsheets/d/.../edit
    const sheetMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]{15,})/);
    if (sheetMatch) {
      return { type: "spreadsheet" as const, id: sheetMatch[1] };
    }

    // Slides:
    // https://docs.google.com/presentation/d/.../edit
    const slideMatch = trimmed.match(/\/presentation\/d\/([a-zA-Z0-9-_]{15,})/);
    if (slideMatch) {
      return { type: "presentation" as const, id: slideMatch[1] };
    }

    // File:
    // https://drive.google.com/file/d/.../view
    const fileMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9-_]{15,})/);
    if (fileMatch) {
      return { type: "file" as const, id: fileMatch[1] };
    }

    return { type: "unknown" as const, id: null };
  }, [pastedUrl]);

  // Monitor Auth State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        // Under AI Studio workspace, we get the access token from Firebase authentication provider 
        // When user logs in, we grab it.
        const savedToken = localStorage.getItem("gdrive_access_token");
        if (savedToken) {
          setToken(savedToken);
        }
      } else {
        setUser(null);
        setToken(null);
      }
      setIsAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Fetch file list when token details or folders change
  useEffect(() => {
    if (token) {
      loadFiles(currentFolderId);
    }
  }, [token, currentFolderId, searchTerm]);

  const loadFiles = async (folderId: string) => {
    if (!token) return;
    setIsLoadingFiles(true);
    try {
      const fetched = await fetchDriveFiles(token, folderId, searchTerm);
      setFiles(fetched);
    } catch (err: any) {
      console.error("파일 로딩 에러:", err);
      // If unauthorized, token might be expired. Force relogin or reset.
      const errMsg = String(err.message || "").toLowerCase();
      if (
        errMsg.includes("401") ||
        errMsg.includes("403") ||
        errMsg.includes("credential") ||
        errMsg.includes("credentials") ||
        errMsg.includes("unauthorized") ||
        errMsg.includes("invalid") ||
        errMsg.includes("auth") ||
        errMsg.includes("token")
      ) {
        handleLogout();
        alert("구글 연동 위임 권한 세션이 만료되었거나 로그인 값이 올바르지 않습니다. 안전한 정밀 조작을 위해 로그인을 진행하시기 바랍니다.");
      }
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const response = await googleSignIn();
      if (response) {
        setToken(response.accessToken);
        setUser(response.user);
        setSelectedFileIds(new Set());
      }
    } catch (err) {
      console.error("Google Sign-In failed:", err);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setToken(null);
    setFiles([]);
    setSelectedFileIds(new Set());
    setConversionQueue([]);
  };

  const handleBatchRename = async () => {
    if (renameCandidates.length === 0 || !token) return;
    
    const confirmRename = window.confirm(
      `감지된 ${renameCandidates.length}개 파일의 이름을 각각 파일명에 포함된 5자리 학번(예: 10101)으로 변경하시겠습니까?\n이 작업은 구글 드라이브의 실제 파일명을 영구 수정합니다.`
    );
    if (!confirmRename) return;

    setIsRenaming(true);
    
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < renameCandidates.length; i++) {
      const file = renameCandidates[i];
      const match = file.name.match(/(?<!\d)(\d{5})(?!\d)/);
      if (!match) continue;
      
      const studentNum = match[1];
      const dotIndex = file.name.lastIndexOf(".");
      const ext = dotIndex !== -1 ? file.name.substring(dotIndex) : "";
      const newName = `${studentNum}${ext}`;
      
      setRenameProgress({
        current: i + 1,
        total: renameCandidates.length,
        fileName: file.name
      });
      
      try {
        await renameDriveFile(token, file.id, newName);
        successCount++;
      } catch (err) {
        console.error(`Failed to rename ${file.name}:`, err);
        failCount++;
      }
    }
    
    setIsRenaming(false);
    setRenameProgress(null);
    
    alert(`정리가 완료되었습니다!\n성공: ${successCount}개${failCount > 0 ? `, 실패: ${failCount}개` : ""}`);
    
    // Refresh the file list
    loadFiles(currentFolderId);
  };

  const handleSingleRename = async (file: DriveFile) => {
    if (!token) return;
    
    const match = file.name.match(/(?<!\d)(\d{5})(?!\d)/);
    if (!match) return;
    
    const studentNum = match[1];
    const dotIndex = file.name.lastIndexOf(".");
    const ext = dotIndex !== -1 ? file.name.substring(dotIndex) : "";
    const newName = `${studentNum}${ext}`;

    const confirmResult = window.confirm(
      `이 파일의 이름을 포함된 학번인 '${newName}'(으)로 변경하시겠습니까?\n\n이 폴더 전체의 학번 파일들을 일괄 정리하고 싶으시다면, 상단의 '학번명 일괄 정리 도우미' 배너를 사용해 주십시오.`
    );
    
    if (!confirmResult) return;

    setIsRenaming(true);
    setRenameProgress({
      current: 1,
      total: 1,
      fileName: file.name
    });

    try {
      await renameDriveFile(token, file.id, newName);
      alert(`성공적으로 파일명을 '${newName}'(으)로 변경했습니다.`);
    } catch (err: any) {
      console.error(`Failed to rename file:`, err);
      alert(`파일명 변경 실패: ${err.message || "알 수 없는 에러"}`);
    } finally {
      setIsRenaming(false);
      setRenameProgress(null);
      loadFiles(currentFolderId);
    }
  };

  // Process pasted Google Drive URLs
  const handleLinkAction = async (parsed: { type: string; id: string | null }) => {
    if (!parsed.id) return;
    setIsUrlProcessing(true);

    try {
      if (parsed.type === "folder") {
        if (!token) {
          // If not logged in, request login first
          setIsLoggingIn(true);
          const response = await googleSignIn();
          if (response) {
            setToken(response.accessToken);
            setUser(response.user);
            const folderName = await fetchFolderName(response.accessToken, parsed.id);
            setFolderPath([
              { id: "root", name: "내 드라이브" },
              { id: parsed.id, name: folderName || "공유된 폴더" }
            ]);
            setCurrentFolderId(parsed.id);
            setPastedUrl("");
            setSelectedFileIds(new Set());
            alert(`구글 로그인 연동 성공! 감지된 폴더 [${folderName || "공유된 폴더"}]로 바로 순간이동했습니다.`);
          }
        } else {
          // If logged in, navigate straight there
          const folderName = await fetchFolderName(token, parsed.id);
          setFolderPath([
            { id: "root", name: "내 드라이브" },
            { id: parsed.id, name: folderName || "공유된 폴더" }
          ]);
          setCurrentFolderId(parsed.id);
          setPastedUrl("");
          setSelectedFileIds(new Set());
          alert(`감지된 폴더 [${folderName || "공유된 폴더"}]로 바로 순간이동했습니다!`);
        }
      } else if (parsed.type === "document" || parsed.type === "spreadsheet" || parsed.type === "presentation") {
        // Direct PDF converter triggers
        if (!token) {
          // Public Export Link Trigger via direct browser redirection
          let exportUrl = "";
          if (parsed.type === "document") exportUrl = `https://docs.google.com/document/d/${parsed.id}/export?format=pdf`;
          if (parsed.type === "spreadsheet") exportUrl = `https://docs.google.com/spreadsheets/d/${parsed.id}/export?format=pdf`;
          if (parsed.type === "presentation") exportUrl = `https://docs.google.com/presentation/d/${parsed.id}/export?format=pdf`;

          const link = document.createElement("a");
          link.href = exportUrl;
          link.target = "_blank";
          link.download = `convert.pdf`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          alert("공유 설정된(링크가 공개된) 구글 문서의 PDF 변환 출력을 다운로드 창으로 전송했습니다! 다운로드가 시작되지 않는다면 파일이 누구나 조회 가능하도록 공개되어 있는지 점검해 주세요.");
          setPastedUrl("");
        } else {
          // Add to task list using existing export flow
          let fileName = "공유된 Google 문서";
          try {
            const url = `https://www.googleapis.com/drive/v3/files/${parsed.id}?fields=name`;
            const headerRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
            if (headerRes.ok) {
              const fileMeta = await headerRes.json();
              fileName = fileMeta.name || "공유된 Google 문서";
            }
          } catch (e) {}

          const task: ConversionTask = {
            id: parsed.id,
            name: fileName,
            mimeType: `application/vnd.google-apps.${parsed.type}`,
            status: "idle",
            progressText: "개별 가공 대기 중...",
          };

          setConversionQueue([task]);
          setPastedUrl("");
          setIsConverting(true);

          let pdfBlob: Blob;
          // Trigger exporting
          try {
            pdfBlob = await exportGoogleDocToPdf(token, parsed.id);
            const pdfUrl = URL.createObjectURL(pdfBlob);
            setConversionQueue(prev => prev.map(t => 
              t.id === task.id ? { ...t, status: "completed", progressText: "변환 완료! 저장할 수 있습니다.", pdfUrl } : t
            ));
            
            let downloadName = fileName.replace(/\.[a-zA-Z0-9]+$/, "");
            if (renameOnDownload) {
              const match = fileName.match(/(?<!\d)(\d{5})(?!\d)/);
              if (match) {
                downloadName = match[1];
              }
            }
            const link = document.createElement("a");
            link.href = pdfUrl;
            link.download = `${downloadName}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          } catch (err: any) {
            setConversionQueue(prev => prev.map(t => 
              t.id === task.id ? { ...t, status: "failed", progressText: "다운로드 중 오류가 발생했습니다.", error: err.message || "해당 파일이 공개되어 있지 않거나 권한이 없습니다." } : t
            ));
          } finally {
            setIsConverting(false);
          }
        }
      } else if (parsed.type === "file") {
        if (!token) {
          // Request login to process HWP or general binaries
          alert("한글(.hwp), 워드(.docx) 등 업로드 파일 변환은 보안 가상 드라이브 업로드가 수반되므로 로그인이 필수적입니다. 우측 상단의 '로그인' 후에 진행해 주세요.");
        } else {
          // Add as file and run regular pipeline
          let fileName = "HWP 한글문서 / 파일";
          let mime = "application/octet-stream";
          try {
            const url = `https://www.googleapis.com/drive/v3/files/${parsed.id}?fields=name,mimeType`;
            const headerRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
            if (headerRes.ok) {
              const fileMeta = await headerRes.json();
              fileName = fileMeta.name || "HWP 한글문서 / 파일";
              mime = fileMeta.mimeType || "application/octet-stream";
            }
          } catch (e) {}

          const task: ConversionTask = {
            id: parsed.id,
            name: fileName,
            mimeType: mime,
            status: "idle",
            progressText: "대기 중...",
          };

          setConversionQueue([task]);
          setPastedUrl("");
          setIsConverting(true);

          try {
            const originalBlob = await downloadDriveFileBlob(token, parsed.id);
            const tempDocId = await uploadAndConvertToGoogleDoc(token, fileName, originalBlob);
            
            try {
              const pdfBlob = await exportGoogleDocToPdf(token, tempDocId);
              const pdfUrl = URL.createObjectURL(pdfBlob);
              setConversionQueue(prev => prev.map(t => 
                t.id === task.id ? { ...t, status: "completed", progressText: "변환 완료! 저장할 수 있습니다.", pdfUrl } : t
              ));
              
              let downloadName = fileName.replace(/\.[a-zA-Z0-9]+$/, "");
              if (renameOnDownload) {
                const match = fileName.match(/(?<!\d)(\d{5})(?!\d)/);
                if (match) {
                  downloadName = match[1];
                }
              }
              const link = document.createElement("a");
              link.href = pdfUrl;
              link.download = `${downloadName}.pdf`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            } finally {
              await deleteDriveFile(token, tempDocId);
            }
          } catch (err: any) {
            setConversionQueue(prev => prev.map(t => 
              t.id === task.id ? { ...t, status: "failed", progressText: "기기 변환 에러가 발생했습니다.", error: err.message || "변환 실패" } : t
            ));
          } finally {
            setIsConverting(false);
          }
        }
      }
    } catch (e: any) {
      console.error(e);
      alert("오류 발생: " + (e.message || "연결 불가"));
    } finally {
      setIsUrlProcessing(false);
      setIsLoggingIn(false);
    }
  };

  // Directory Drilling Navigation
  const navigateToFolder = async (folder: DriveFile) => {
    if (folder.mimeType !== "application/vnd.google-apps.folder") return;
    
    // Append to path breadcrumbs
    const newPath = [...folderPath, { id: folder.id, name: folder.name }];
    setFolderPath(newPath);
    setCurrentFolderId(folder.id);
    setSelectedFileIds(new Set());
  };

  const navigateToBreadcrumb = (index: number) => {
    const newPath = folderPath.slice(0, index + 1);
    setFolderPath(newPath);
    setCurrentFolderId(newPath[newPath.length - 1].id);
    setSelectedFileIds(new Set());
  };

  const navigateUp = () => {
    if (folderPath.length <= 1) return;
    navigateToBreadcrumb(folderPath.length - 2);
  };

  // Filtering files
  const filteredFiles = useMemo(() => {
    return files.filter(file => {
      const isFolder = file.mimeType === "application/vnd.google-apps.folder";
      if (isFolder) return true; // folders always visible for browsing

      const name = file.name.toLowerCase();
      if (filterType === "hwp") {
        return name.endsWith(".hwp") || file.mimeType.includes("hwp");
      }
      if (filterType === "google_doc") {
        return file.mimeType.startsWith("application/vnd.google-apps.document") || 
               file.mimeType.startsWith("application/vnd.google-apps.spreadsheet") ||
               file.mimeType.startsWith("application/vnd.google-apps.presentation");
      }
      if (filterType === "other") {
        return name.endsWith(".docx") || file.mimeType.includes("officedocument") || file.mimeType === "application/pdf";
      }
      return true;
    });
  }, [files, filterType]);

  const selectAllSelectableFiles = () => {
    const selectables = filteredFiles.filter(f => f.mimeType !== "application/vnd.google-apps.folder");
    const allSelected = selectables.every(f => selectedFileIds.has(f.id));
    
    const newSelection = new Set(selectedFileIds);
    if (allSelected) {
      selectables.forEach(f => newSelection.delete(f.id));
    } else {
      selectables.forEach(f => newSelection.add(f.id));
    }
    setSelectedFileIds(newSelection);
  };

  const toggleSelectFile = (fileId: string) => {
    const newSelection = new Set(selectedFileIds);
    if (newSelection.has(fileId)) {
      newSelection.delete(fileId);
    } else {
      newSelection.add(fileId);
    }
    setSelectedFileIds(newSelection);
  };

  // Core conversion execution pipeline (handles both Google Drive files and local uploaded files)
  const runConversion = async (tasks: ConversionTask[], overrideToken?: string) => {
    const activeToken = overrideToken || token;
    if (!activeToken) return;

    setIsConverting(true);
    const successfulPdfs: { name: string; blob: Blob }[] = [];

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      
      const updateTaskStatus = (
        status: ConversionTask["status"], 
        progressText: string, 
        error?: string,
        pdfUrl?: string
      ) => {
        setConversionQueue(prev => prev.map(t => 
          t.id === task.id ? { ...t, status, progressText, error, pdfUrl } : t
        ));
      };

      try {
        let pdfBlob: Blob;

        if (task.localFile) {
          // Local File Conversion Flow:
          updateTaskStatus("uploading", "임시 구글 가상 변환기로 업로드 중...");
          const tempDocId = await uploadAndConvertToGoogleDoc(activeToken, task.name, task.localFile);

          try {
            updateTaskStatus("exporting", "고화질 PDF로 문서 포맷 렌더링 중...");
            pdfBlob = await exportGoogleDocToPdf(activeToken, tempDocId);
          } finally {
            // Cleanup from user's Drive right away
            try {
              await deleteDriveFile(activeToken, tempDocId);
            } catch (e) {
              console.warn("임시 파일 정리 실패:", e);
            }
          }
        } else {
          // Google Drive File Conversion Flow:
          const isGoogleDoc = 
            task.mimeType.startsWith("application/vnd.google-apps.document") || 
            task.mimeType.startsWith("application/vnd.google-apps.spreadsheet") ||
            task.mimeType.startsWith("application/vnd.google-apps.presentation");

          if (isGoogleDoc) {
            updateTaskStatus("exporting", "Google 드라이브에서 직접 PDF 내보내는 중...");
            pdfBlob = await exportGoogleDocToPdf(activeToken, task.id);
          } else {
            updateTaskStatus("downloading", "드라이브에서 원본 이진 데이터 다운로드 중...");
            const originalBlob = await downloadDriveFileBlob(activeToken, task.id);

            updateTaskStatus("uploading", "임시 구글 변환 버퍼로 업로드 중...");
            const tempDocId = await uploadAndConvertToGoogleDoc(activeToken, task.name, originalBlob);

            try {
              updateTaskStatus("exporting", "PDF 렌더링 파이프라인 가동 중...");
              pdfBlob = await exportGoogleDocToPdf(activeToken, tempDocId);
            } finally {
              try {
                await deleteDriveFile(activeToken, tempDocId);
              } catch (e) {
                console.warn("임시 변환 파일 정리 실패:", e);
              }
            }
          }
        }

        // Generate locally accessible URL
        const pdfUrl = URL.createObjectURL(pdfBlob);
        updateTaskStatus("completed", "변환 완료! 저장할 수 있습니다.", undefined, pdfUrl);

        let downloadName = task.name.replace(/\.[a-zA-Z0-9]+$/, "");
        if (renameOnDownload) {
          const match = task.name.match(/(?<!\d)(\d{5})(?!\d)/);
          if (match) {
            downloadName = match[1];
          }
        }

        successfulPdfs.push({ name: `${downloadName}.pdf`, blob: pdfBlob });

        // Auto trigger download only if NOT downloading as a single ZIP
        if (!downloadAsZip) {
          const link = document.createElement("a");
          link.href = pdfUrl;
          link.download = `${downloadName}.pdf`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }

      } catch (err: any) {
        console.error(`변환 실패 (${task.name}):`, err);
        const errMsg = String(err.message || "").toLowerCase();
        if (
          errMsg.includes("401") ||
          errMsg.includes("403") ||
          errMsg.includes("credential") ||
          errMsg.includes("credentials") ||
          errMsg.includes("unauthorized") ||
          errMsg.includes("invalid") ||
          errMsg.includes("auth") ||
          errMsg.includes("token")
        ) {
          handleLogout();
          alert("구글 연동 위임 권한 세션이 만료되었습니다. 안전한 기동을 위해 재로그인을 완료하시기 바랍니다.");
          setIsConverting(false);
          return;
        } else {
          updateTaskStatus("failed", "변환 오류 발생", err.message || "알 수 없는 에러가 발생했습니다.");
        }
      }
    }

    // Zip conversion results together if option selected and successful PDFs are present
    if (downloadAsZip && successfulPdfs.length > 0) {
      try {
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();

        successfulPdfs.forEach(file => {
          zip.file(file.name, file.blob);
        });

        const zipBlob = await zip.generateAsync({ type: "blob" });
        const zipUrl = URL.createObjectURL(zipBlob);

        const link = document.createElement("a");
        link.href = zipUrl;
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        link.download = `pdf_package_${dateStr}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (zipErr) {
        console.error("ZIP 파일 제작 실패:", zipErr);
        alert("ZIP 압축 생성 도중 에러가 발생했습니다. 하단 개별 변환 완료창에서 각 파일을 재다운로드해 주십시오.");
      }
    }

    setIsConverting(false);
  };

  // Convert files in selected list to PDF
  const startPdfConversion = async () => {
    if (selectedFileIds.size === 0 || !token) return;

    const filesToConvert = files.filter(f => selectedFileIds.has(f.id));
    const tasks: ConversionTask[] = filesToConvert.map(f => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      status: "idle",
      progressText: "대기 중...",
    }));

    setConversionQueue(tasks);
    await runConversion(tasks);
  };

  // Handle local file uploads conversion
  const handleLocalFilesUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    // Check Google Login first
    if (!token) {
      const confirmLogin = window.confirm(
        "로컬 파일 직접 업로드 변환 기능은 실시간 임시 구글 Docs 가상 변환기를 가동하므로, 최초 1회의 안전한 Google 계정 연결 위임 처리가 필요합니다.\n\n구글 계정 연결을 가동하시겠습니까?"
      );
      if (confirmLogin) {
        try {
          setIsLoggingIn(true);
          const result = await googleSignIn();
          if (result) {
            setToken(result.accessToken);
            setUser(result.user);
            setAccessToken(result.accessToken);
            
            // Build tasks and run using newly obtained token
            const tasks: ConversionTask[] = Array.from(fileList).map((file, idx) => ({
              id: `local-${Date.now()}-${idx}-${Math.random()}`,
              name: file.name,
              mimeType: file.type || "application/octet-stream",
              status: "idle",
              progressText: "대기 중...",
              localFile: file,
            }));
            setConversionQueue(tasks);
            await runConversion(tasks, result.accessToken);
          }
        } catch (err: any) {
          alert("구글 계정 연동 실패: " + (err.message || "로그인 불가"));
        } finally {
          setIsLoggingIn(false);
        }
      }
      return;
    }

    // Already signed in
    const tasks: ConversionTask[] = Array.from(fileList).map((file, idx) => ({
      id: `local-${Date.now()}-${idx}-${Math.random()}`,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      status: "idle",
      progressText: "대기 중...",
      localFile: file,
    }));
    setConversionQueue(tasks);
    await runConversion(tasks);
  };

  // Drag and Drop Handlers for local uploads
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleLocalFilesUpload(e.dataTransfer.files);
    }
  };

  // Render original file format badge
  const getFormatBadge = (mimeType: string, filename: string) => {
    const isFolder = mimeType === "application/vnd.google-apps.folder";
    if (isFolder) return null;

    const lowerName = filename.toLowerCase();
    
    if (lowerName.endsWith(".hwp")) {
      return (
        <span className="px-2 py-0.5 text-[11px] font-semibold bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400 rounded-md border border-red-200 dark:border-red-900/50">
          HWP 한글문서
        </span>
      );
    }
    if (mimeType.includes("wordprocessingml") || lowerName.endsWith(".docx") || lowerName.endsWith(".doc")) {
      return (
        <span className="px-2 py-0.5 text-[11px] font-semibold bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 rounded-md border border-blue-200 dark:border-blue-900/50">
          MS Word
        </span>
      );
    }
    if (mimeType.includes("google-apps.document")) {
      return (
        <span className="px-2 py-0.5 text-[11px] font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400 rounded-md border border-indigo-200 dark:border-indigo-900/50">
          구글 문서
        </span>
      );
    }
    if (mimeType.includes("google-apps.spreadsheet")) {
      return (
        <span className="px-2 py-0.5 text-[11px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 rounded-md border border-emerald-200 dark:border-emerald-900/50">
          스프레드시트
        </span>
      );
    }
    if (mimeType.includes("google-apps.presentation")) {
      return (
        <span className="px-2 py-0.5 text-[11px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 rounded-md border border-amber-200 dark:border-amber-900/50">
          프레젠테이션
        </span>
      );
    }
    if (mimeType === "application/pdf") {
      return (
        <span className="px-2 py-0.5 text-[11px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 rounded-md">
          PDF
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 text-[11px] font-semibold bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400 rounded-md">
        일반 문서
      </span>
    );
  };

  // Get visually stunning file icons
  const getFileIcon = (file: DriveFile) => {
    if (file.mimeType === "application/vnd.google-apps.folder") {
      return <Folder className="w-5 h-5 text-amber-500 fill-amber-500/10" />;
    }
    
    const lowerName = file.name.toLowerCase();
    
    if (lowerName.endsWith(".hwp")) {
      return <FileCode className="w-5 h-5 text-red-500" />;
    }
    if (file.mimeType.includes("google-apps.document") || file.mimeType.includes("word")) {
      return <FileText className="w-5 h-5 text-blue-500" />;
    }
    if (file.mimeType.includes("google-apps.spreadsheet") || file.mimeType.includes("excel") || file.mimeType.includes("sheet")) {
      return <FileText className="w-5 h-5 text-emerald-500" />;
    }
    if (file.mimeType.includes("google-apps.presentation") || file.mimeType.includes("powerpoint")) {
      return <FileText className="w-5 h-5 text-amber-500" />;
    }
    return <File className="w-5 h-5 text-slate-400" />;
  };

  // Format File Size
  const formatBytes = (bytesStr?: string) => {
    if (!bytesStr) return "-";
    const bytes = parseInt(bytesStr, 10);
    if (isNaN(bytes)) return "-";
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans leading-relaxed tracking-normal flex flex-col">
      
      {/* HEADER SECTION */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200/80 px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-indigo-500 to-blue-600 text-white p-2.5 rounded-xl shadow-md shadow-indigo-600/10">
            <FileDown className="w-6 h-6 stroke-[2]" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
              Google Drive PDF Converter
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full">
                한글 및 스마트 문서 변환
              </span>
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              별도의 프로그램 설치 없이 누구나 구글 드라이브 속 모든 문서를 고품질 PDF로 즉석 가공합니다
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 self-end md:self-auto">
          <button 
            onClick={() => setShowHelpModal(true)}
            className="p-2.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all duration-200"
            title="도움말 보기"
          >
            <HelpCircle className="w-5 h-5" />
          </button>
          
          {user ? (
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-100 p-1.5 pr-3 rounded-full hover:shadow-sm transition-all">
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.displayName || "User"} referrerPolicy="no-referrer" className="w-8 h-8 rounded-full border border-white shadow-sm" />
              ) : (
                <div className="w-8 h-8 bg-indigo-500 text-white flex items-center justify-center rounded-full text-xs font-bold">
                  {user.displayName?.[0] || "U"}
                </div>
              )}
              <div className="hidden sm:block text-left text-xs">
                <p className="font-semibold text-slate-700 max-w-[120px] truncate">{user.displayName || "구글 사용자"}</p>
                <p className="text-[10px] text-slate-400 truncate max-w-[140px]">{user.email}</p>
              </div>
              <button 
                onClick={handleLogout}
                className="ml-2 p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-full transition-colors"
                title="Google 계정 로그아웃"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <span className="text-xs text-slate-400">구글 연결 대기중</span>
          )}
        </div>
      </header>

      {/* CORE WORKSPACE */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* LINK DIRECT PASTE CONVERTER */}
        <div className="col-span-12 bg-white border border-slate-200/85 rounded-2xl p-5 md:p-6 shadow-sm">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl shrink-0">
                <FileDown className="w-6 h-6 stroke-[2]" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 tracking-tight">구글 드라이브 간편 링크 직접 변환기 (로그인 불필요)</h2>
                <p className="text-xs text-slate-500 mt-1 leading-normal max-w-3xl">
                  편집/조회 권한이 있는 공유 폴더 링크나 개별 구글 문서(Docs, Sheets, Slides), 파일 링크를 복사하여 아래에 붙여넣어 보세요. 
                  폴더는 연동 즉시 화면이 자동 전환되고, 개별 문서는 구글 로그인 없이도 즉시 PDF 다운로드가 작동합니다!
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <input 
                type="text"
                placeholder="구글 드라이브 공유 폴더 혹은 문서 링크 복사 후 붙여넣기 (예: https://drive.google.com/... 또는 https://docs.google.com/...)"
                value={pastedUrl}
                onChange={(e) => setPastedUrl(e.target.value)}
                className="w-full bg-slate-50 border border-slate-250 text-slate-800 placeholder-slate-400 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 text-sm pl-4 pr-10 py-3 rounded-xl outline-none transition-all font-sans"
              />
              {pastedUrl && (
                <button
                  onClick={() => setPastedUrl("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-650 font-medium"
                >
                  지우기
                </button>
              )}
            </div>
            <button
              onClick={() => parsedLink && handleLinkAction(parsedLink)}
              disabled={!parsedLink || parsedLink.type === "unknown" || isUrlProcessing}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 text-white font-semibold text-sm px-6 py-3 rounded-xl transition-all flex items-center justify-center gap-2 shrink-0 h-[46px]"
            >
              {isUrlProcessing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "분석 및 변환 실행"
              )}
            </button>
          </div>

          {/* Real-time description card based on Parsed Link */}
          {parsedLink && (
            <div className={`mt-3.5 p-4 rounded-xl border border-slate-150 text-xs text-slate-650 leading-relaxed shadow-inner ${
              parsedLink.type === "unknown" ? "bg-rose-50/50 border-rose-150" : "bg-slate-50"
            }`}>
              {parsedLink.type === "folder" ? (
                <div className="space-y-1">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-blue-50 text-blue-600 font-bold border border-blue-100/50">
                    📂 구글 드라이브 폴더가 감지되었습니다
                  </span>
                  <p className="mt-1.5">
                    {token 
                      ? "사용자 연동 세션이 활성화 중이므로, '분석 및 변환 실행' 클릭 시 즉시 해당 공유 폴더 내부로 화면이 자동 전환되어 한글/문서 파일을 한 번에 체크하여 일괄로 다룰 수 있습니다." 
                      : "구글 보안 정책상 폴더 속 상세 파일 리스트를 검색하고 조회하려면 1회성 구글 위임 권한이 필요합니다. '분석 및 변환 실행'을 누르시면 [구글 로그인 연동]과 함께 즉시 해당 공유 폴더로 순간 이동합니다."}
                  </p>
                </div>
              ) : parsedLink.type === "document" || parsedLink.type === "spreadsheet" || parsedLink.type === "presentation" ? (
                <div className="space-y-1">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 font-bold border border-emerald-100/50">
                    📝 구글 스마트 오피스 문서 양식 감지됨
                  </span>
                  <p className="mt-1.5">
                    해당 파일의 권한 설정이 '링크가 있는 모든 사용자'로 공유 설정되어 있는 경우, <strong>구글 로그인 없이도 바로 PDF로 백업 렌더링된 사본 다운로딩이 개시</strong>됩니다! 
                    로그인 없이 즉시 문서 PDF를 획득해 보세요.
                  </p>
                </div>
              ) : parsedLink.type === "file" ? (
                <div className="space-y-1">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-50 text-amber-600 font-bold border border-amber-100/50">
                    📎 업로드형 바이너리 공유 파일 감지됨
                  </span>
                  <p className="mt-1.5">
                    원본 아래 한글파일(.hwp)이나 워드(.docx) 등은 구글 드라이브 오피스 연동 가상 변환기를 구동하여 보안 가상 업로드 상태에서 처리해야 안전합니다. 
                    따라서 <strong>구글 로그인이 필수적</strong>이며, 로그인 상태로 '분석 및 변환 실행' 시 모든 가공 작업이 오토매틱하게 원터치 진행됩니다.
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-rose-600">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                  <p className="font-semibold">유효한 구글 드라이브 공유 링크 구조가 아닙니다. 공유 폴더 혹은 문서 공유 URL 형식인지 확인 후 다시 장착해 주십시오.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* IF NOT LOGGED IN & NO TOKEN */}
        {!user || !token ? (
          <div className="col-span-12 flex flex-col items-center justify-center py-6 px-4">
            <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
              
              {/* Left Column: Google Login */}
              <motion.div 
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5 }}
                className="bg-white border border-slate-200/80 rounded-3xl p-8 shadow-xl text-center flex flex-col justify-between"
              >
                <div>
                  <div className="relative inline-block mb-6">
                    <div className="absolute inset-0 bg-indigo-100 rounded-3xl blur-md scale-110"></div>
                    <div className="relative bg-gradient-to-tr from-indigo-500 to-blue-600 text-white p-5 rounded-2xl shadow-lg">
                      <FileDown className="w-10 h-10" />
                    </div>
                  </div>
                  <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">구글 드라이브 원격 탐색기 기동</h2>
                  <p className="text-slate-500 text-xs mt-3 leading-relaxed max-w-sm mx-auto">
                    안전한 원격 공유 폴더 탐색과 한글(.hwp) 변환 파이프라인 원클릭 가동, 다중 파일 일괄 렌더링을 시작하시려면 신속한 Google 계정 연결을 실행하십시오.
                  </p>
                </div>

                <div className="mt-8 space-y-4">
                  <button
                    onClick={handleLogin}
                    disabled={isLoggingIn}
                    className="w-full flex items-center justify-center gap-3 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3.5 px-6 rounded-2xl shadow-lg shadow-indigo-600/20 active:scale-[0.98] transition-all disabled:opacity-75 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {isLoggingIn ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <svg className="w-5 h-5" viewBox="0 0 48 48">
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                      </svg>
                    )}
                    <span className="font-semibold text-sm">구글 계정 연결하고 탐색기 기동</span>
                  </button>

                  <div className="text-[11px] text-slate-450 text-center">
                    본 클라이언트 변환 엔진은 어떠한 사용자 암호 토큰도 수집하지 않으며 메모리 파기 시 자동 영구 폐기됩니다.
                  </div>
                </div>
              </motion.div>

              {/* Right Column: Local Drag & Drop Upload */}
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5 }}
                className={`bg-white border rounded-3xl p-8 shadow-xl text-center flex flex-col justify-between transition-all duration-300 ${
                  isDragOver 
                    ? "border-indigo-500 bg-indigo-50/20 ring-4 ring-indigo-500/10 scale-[1.01]" 
                    : "border-slate-200/80 hover:border-slate-300"
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <div>
                  <div className="relative inline-block mb-6">
                    <div className="absolute inset-0 bg-blue-100 rounded-3xl blur-md scale-110"></div>
                    <div className="relative bg-gradient-to-tr from-blue-500 to-indigo-600 text-white p-5 rounded-2xl shadow-lg">
                      <Upload className="w-10 h-10" />
                    </div>
                  </div>
                  <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">내 PC 파일 직접 드롭 및 자동 변환</h2>
                  <p className="text-slate-500 text-xs mt-3 leading-relaxed max-w-sm mx-auto">
                    가지고 계신 한글(.hwp), 워드(.docx) 파일을 아래 전용 드롭존에 즉시 투하하거나 클릭하여 실시간 변환 다운로드를 개시하십시오.
                  </p>
                </div>

                <div className="mt-6 space-y-4">
                  <div 
                    className={`border-2 border-dashed rounded-2xl p-8 text-center flex flex-col items-center justify-center cursor-pointer transition-colors ${
                      isDragOver 
                        ? "border-indigo-400 bg-indigo-50/30" 
                        : "border-slate-200 hover:border-indigo-400 bg-slate-50/40 hover:bg-indigo-50/5"
                    }`}
                    onClick={() => document.getElementById("local-file-picker-unauth")?.click()}
                  >
                    <Upload className={`w-10 h-10 mb-2 transition-transform ${isDragOver ? "text-indigo-600 scale-110 animate-bounce" : "text-slate-400"}`} />
                    <p className="text-xs font-bold text-slate-700">마우스로 로컬 파일을 끌어놓거나 클릭하세요</p>
                    <p className="text-[10px] text-slate-450 mt-1">HWP, DOCX, DOC, XLS, PPT, TXT, PDF 등 지원</p>
                    <p className="text-[10px] text-indigo-500 font-bold mt-2">※ 파일 변환을 위한 1회성 간편 구글 로그인이 자동 연계됩니다.</p>
                    
                    <input 
                      type="file" 
                      id="local-file-picker-unauth"
                      multiple
                      className="hidden" 
                      onChange={(e) => handleLocalFilesUpload(e.target.files)}
                    />
                  </div>
                </div>
              </motion.div>

            </div>
          </div>
        ) : (
          <>
            {/* FILE EXPLORER (LEFT - 7 COLUMNS) */}
            <div className="col-span-12 lg:col-span-7 flex flex-col bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden min-h-[600px]">
              
              {/* Explorer Header & Controls */}
              <div className="p-4 border-b border-slate-200/80 bg-slate-50/50 space-y-3.5">
                
                {/* Search & Refresh */}
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 o-4 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="내 드라이브에서 파일 검색하기..." 
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full bg-white border border-slate-200 pl-10 pr-4 py-2 text-sm rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 outline-none transition-all"
                    />
                    {searchTerm && (
                      <button 
                        onClick={() => setSearchTerm("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-450 hover:text-slate-600 bg-slate-100 rounded-md px-1.5 py-0.5"
                      >
                        지우기
                      </button>
                    )}
                  </div>
                  <button 
                    onClick={() => loadFiles(currentFolderId)}
                    disabled={isLoadingFiles}
                    className="p-2.5 bg-white border border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-100 hover:bg-indigo-50/20 active:scale-95 transition-all rounded-xl disabled:opacity-50"
                    title="새로고침"
                  >
                    <RefreshCw className={`w-4 h-4 ${isLoadingFiles ? "animate-spin" : ""}`} />
                  </button>
                </div>

                {/* Path and Breadcrumbs */}
                <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 text-xs">
                  <div className="flex items-center gap-1.5 text-slate-500 shrink-0">
                    {folderPath.length > 1 && (
                      <button 
                        onClick={navigateUp}
                        className="p-1 text-slate-600 hover:bg-slate-200/70 rounded-md transition-colors mr-1"
                        title="상위 폴더"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {folderPath.map((folder, idx) => (
                      <div key={folder.id} className="flex items-center">
                        {idx > 0 && <ChevronRight className="w-3 h-3 mx-1 text-slate-300" />}
                        <button
                          onClick={() => navigateToBreadcrumb(idx)}
                          className={`hover:text-indigo-600 hover:underline font-medium ${
                            idx === folderPath.length - 1 ? "text-slate-900 font-bold" : ""
                          }`}
                        >
                          {folder.name}
                        </button>
                      </div>
                    ))}
                  </div>

                  <span className="text-[11px] text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">
                    {filteredFiles.length}개 항목
                  </span>
                </div>

                {/* Filter Options */}
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setFilterType("all")}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                      filterType === "all"
                        ? "bg-indigo-600 border-indigo-600 text-white shadow-sm"
                        : "bg-white border-slate-200 text-slate-650 hover:bg-slate-100"
                    }`}
                  >
                    모체 전체
                  </button>
                  <button
                    onClick={() => setFilterType("hwp")}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                      filterType === "hwp"
                        ? "bg-red-650 border-red-650 text-white shadow-sm"
                        : "bg-white border-slate-200 text-slate-650 hover:bg-slate-100"
                    }`}
                  >
                    hwp 한글문서 (.hwp)
                  </button>
                  <button
                    onClick={() => setFilterType("google_doc")}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                      filterType === "google_doc"
                        ? "bg-indigo-600 border-indigo-600 text-white shadow-sm"
                        : "bg-white border-slate-200 text-slate-650 hover:bg-slate-100"
                    }`}
                  >
                    구글 문서 양식
                  </button>
                  <button
                    onClick={() => setFilterType("other")}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                      filterType === "other"
                        ? "bg-blue-600 border-blue-600 text-white shadow-sm"
                        : "bg-white border-slate-200 text-slate-650 hover:bg-slate-100"
                    }`}
                  >
                    MS 오피스 및 PDF
                  </button>
                </div>

              </div>

              {/* Files Table / List */}
              <div className="flex-1 overflow-y-auto max-h-[500px]">
                {/* Batch Rename Helper Banner */}
                {renameCandidates.length > 0 && !isLoadingFiles && (
                  <div className="mx-4 my-3 p-3.5 bg-indigo-50/70 border border-indigo-100 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-inner">
                    <div className="flex items-start gap-2.5 text-left">
                      <div className="p-1.5 bg-indigo-100 rounded-lg text-indigo-700 shrink-0 mt-0.5 sm:mt-0">
                        <Settings className="w-4 h-4 animate-spin" style={{ animationDuration: '10s' }} />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                          <span>학번명 일괄 정리 도우미</span>
                          <span className="bg-indigo-600 text-white text-[9px] px-1.5 py-0.2 rounded-full font-bold">감지 {renameCandidates.length}개</span>
                        </h4>
                        <p className="text-[11px] text-slate-500 mt-0.5 leading-normal">
                          파일명에 5자리 학번(예: 10101)이 포함되었지만 아직 학번만으로 정리되지 않은 파일이 발견되었습니다. 파일명을 학번으로만 깔끔하게 일괄 변경하시겠습니까?
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleBatchRename}
                      className="shrink-0 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-xs font-bold rounded-lg transition-all shadow-sm"
                    >
                      예, 일괄 변경하기
                    </button>
                  </div>
                )}

                {isLoadingFiles ? (
                  <div className="flex flex-col items-center justify-center p-20 space-y-3">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                    <p className="text-sm text-slate-500">구글 드라이브 파일 로딩 중...</p>
                  </div>
                ) : filteredFiles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-20 text-center">
                    <div className="p-4 bg-slate-100 rounded-full text-slate-400 mb-3">
                      <Folder className="w-8 h-8" />
                    </div>
                    <p className="text-slate-600 font-semibold">보관함 파일이 없습니다.</p>
                    <p className="text-xs text-slate-400 mt-1 max-w-sm">
                      현재 폴더에 적용 가능한 문서가 없거나, 검색 필터 조건과 일치하는 파일이 존재하지 않는 것 같습니다.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    
                    {/* Header Row */}
                    <div className="flex items-center px-4 py-2 bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      <div className="flex items-center gap-3 w-10 shrink-0">
                        <input 
                          type="checkbox" 
                          checked={
                            filteredFiles.filter(f => f.mimeType !== "application/vnd.google-apps.folder").length > 0 &&
                            filteredFiles.filter(f => f.mimeType !== "application/vnd.google-apps.folder").every(f => selectedFileIds.has(f.id))
                          }
                          onChange={selectAllSelectableFiles}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                        />
                      </div>
                      <div className="flex-1 min-w-0">파일명 / 양식</div>
                      <div className="w-24 text-right hidden sm:block">크기</div>
                    </div>

                    {/* Files / Folder Rows */}
                    {filteredFiles.map((file) => {
                      const isFolder = file.mimeType === "application/vnd.google-apps.folder";
                      const isSelected = selectedFileIds.has(file.id);

                      return (
                        <div 
                          key={file.id}
                          onClick={() => {
                            if (isFolder) {
                              navigateToFolder(file);
                            } else {
                              toggleSelectFile(file.id);
                            }
                          }}
                          className={`flex items-center px-4 py-3 hover:bg-slate-50 cursor-pointer transition-all ${
                            isSelected ? "bg-indigo-50/40 hover:bg-indigo-50/60" : ""
                          }`}
                        >
                          <div 
                            className="w-10 shrink-0" 
                            onClick={(e) => {
                              e.stopPropagation(); // Prevent folder navigate
                              if (!isFolder) toggleSelectFile(file.id);
                            }}
                          >
                            {!isFolder ? (
                              <input 
                                type="checkbox" 
                                checked={isSelected}
                                onChange={() => toggleSelectFile(file.id)}
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                              />
                            ) : (
                              <Folder className="w-4 h-4 text-slate-400" />
                            )}
                          </div>

                          <div className="flex-1 min-w-0 flex items-center gap-3">
                            <div className="shrink-0 p-1.5 bg-slate-100 rounded-lg">
                              {getFileIcon(file)}
                            </div>
                            <div className="text-left flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="text-sm font-semibold text-slate-800 line-clamp-1">
                                  {file.name}
                                </p>
                                {renameCandidates.some(c => c.id === file.id) && (
                                  <span className="shrink-0 bg-amber-50 text-amber-700 border border-amber-200/50 text-[9px] px-1.5 py-0.5 rounded font-bold">
                                    학번감지
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                {getFormatBadge(file.mimeType, file.name)}
                                {file.createdTime && (
                                  <span className="text-[10px] text-slate-400">
                                    {new Date(file.createdTime).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="w-28 text-right text-xs text-slate-500 hidden sm:flex items-center justify-end gap-1.5 shrink-0">
                            <span>{isFolder ? "디렉토리" : formatBytes(file.size)}</span>
                            {renameCandidates.some(c => c.id === file.id) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSingleRename(file);
                                }}
                                className="ml-1 px-1.5 py-0.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-150 text-indigo-700 text-[10px] font-bold rounded-md transition-colors shrink-0 cursor-pointer"
                                title="포함된 5자리 학번으로 파일명 정리"
                              >
                                학번정리
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}

                  </div>
                )}
              </div>

            </div>

            {/* CONVERSION PANEL (RIGHT - 5 COLUMNS) */}
            <div className="col-span-12 lg:col-span-5 flex flex-col gap-6">
              
              {/* Actions and Status Card */}
              <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-4">
                <h2 className="text-base font-bold text-slate-950 flex items-center gap-2">
                  <span>변환 및 다운로드 제어판</span>
                  {selectedFileIds.size > 0 && (
                    <span className="bg-indigo-500 text-white text-xs px-2.5 py-0.5 rounded-full font-bold animate-pulse">
                      선택 {selectedFileIds.size}개
                    </span>
                  )}
                </h2>

                <p className="text-slate-500 text-xs">
                  구글 드라이브 내에서 변환 대상 문서들을 체크한 뒤 아래 변환 버튼을 실행하면 다운로드가 즉시 생성됩니다. 한글 파일(.hwp) 형식도 완전 호환 처리됩니다.
                </p>

                <div className="flex items-start gap-2.5 p-3 bg-indigo-50/50 border border-indigo-100 rounded-xl">
                  <input
                    type="checkbox"
                    id="rename-on-download-cb"
                    checked={renameOnDownload}
                    onChange={(e) => setRenameOnDownload(e.target.checked)}
                    className="rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer mt-0.5 shrink-0"
                  />
                  <div className="text-left">
                    <label htmlFor="rename-on-download-cb" className="text-xs font-bold text-slate-800 cursor-pointer select-none">
                      PDF 다운로드 시 학번만 추출하여 저장
                    </label>
                    <p className="text-[10px] text-slate-500 leading-normal mt-0.5">
                      파일명에 5자리 학번이 감지되면 다운로드 파일명을 해당 학번(예: 10101.pdf)으로 자동 지정합니다. (드라이브 원본 파일명 보존)
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 p-3 bg-blue-50/50 border border-blue-100 rounded-xl">
                  <input
                    type="checkbox"
                    id="download-as-zip-cb"
                    checked={downloadAsZip}
                    onChange={(e) => setDownloadAsZip(e.target.checked)}
                    className="rounded border-blue-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer mt-0.5 shrink-0"
                  />
                  <div className="text-left">
                    <label htmlFor="download-as-zip-cb" className="text-xs font-bold text-slate-800 cursor-pointer select-none">
                      일괄 다운로드 시 하나의 ZIP 압축파일로 받기
                    </label>
                    <p className="text-[10px] text-slate-500 leading-normal mt-0.5">
                      여러 파일을 일괄 변환할 때, 개별 다운로드하지 않고 하나의 .zip 패키지 파일로 묶어서 다운로드합니다. (기본: 개별 다운로드)
                    </p>
                  </div>
                </div>

                {selectedFileIds.size === 0 ? (
                  <div className="bg-slate-50 rounded-xl p-5 text-center border border-slate-100 flex flex-col items-center justify-center min-h-[140px]">
                    <FileText className="w-8 h-8 text-slate-350 stroke-[1.5] mb-2 animate-bounce" />
                    <p className="text-slate-600 text-xs font-semibold">선택한 파일이 없습니다</p>
                    <p className="text-[10px] text-slate-400 mt-1">왼쪽 파일 탐색기에서 한글파일, 워드 혹은 구글문서의 체크박스를 확인해 주세요.</p>
                  </div>
                ) : (
                  <div className="space-y-3.5">
                    <div className="outline-none py-1 overflow-y-auto max-h-[140px] divide-y divide-slate-100 border border-slate-100 rounded-xl bg-slate-50/50 p-2 text-xs">
                      {files.filter(f => selectedFileIds.has(f.id)).map(file => (
                        <div key={file.id} className="flex items-center justify-between p-1.5 gap-2 text-left">
                          <span className="font-semibold text-slate-700 truncate flex-1">{file.name}</span>
                          <span className="text-[10px] text-slate-400 shrink-0 font-mono">{formatBytes(file.size)}</span>
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={startPdfConversion}
                      disabled={isConverting}
                      className="w-full flex items-center justify-center gap-2 bg-gradient-to-tr from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold py-3 px-5 rounded-xl shadow-lg shadow-indigo-600/10 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      {isConverting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>PDF 변환 가공 중...</span>
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4" />
                          <span>선택 {selectedFileIds.size}개 일괄 PDF 변환 및 다운로드</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* Local File Direct Upload Card */}
              <div 
                className={`bg-white border rounded-2xl p-5 shadow-sm transition-all duration-300 ${
                  isDragOver 
                    ? "border-indigo-500 bg-indigo-50/20 ring-4 ring-indigo-500/10 scale-[1.01]" 
                    : "border-slate-200/80 hover:border-slate-300"
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-2">
                  <Upload className="w-4 h-4 text-indigo-500" />
                  <span>내 PC 파일 직접 업로드 변환</span>
                </h3>
                <p className="text-slate-500 text-[11px] leading-relaxed mb-4">
                  보유하신 한글(.hwp), 워드(.docx), 문서 파일을 끌어다 놓거나 아래 버튼을 통해 즉시 클라우드 가상 버퍼로 업로드하여 고화질 PDF로 변환 및 다운로드할 수 있습니다.
                </p>

                <div 
                  className={`border-2 border-dashed rounded-xl p-6 text-center flex flex-col items-center justify-center cursor-pointer transition-colors ${
                    isDragOver 
                      ? "border-indigo-400 bg-indigo-50/30" 
                      : "border-slate-200 hover:border-indigo-400 bg-slate-50/40 hover:bg-indigo-50/5"
                  }`}
                  onClick={() => document.getElementById("local-file-picker")?.click()}
                >
                  <Upload className={`w-8 h-8 mb-2.5 transition-transform ${isDragOver ? "text-indigo-600 scale-110 animate-bounce" : "text-slate-400"}`} />
                  <p className="text-xs font-bold text-slate-700">마우스로 파일을 끌어놓거나 클릭하세요</p>
                  <p className="text-[10px] text-slate-450 mt-1">HWP, DOCX, DOC, XLS, PPT, TXT, PDF 등 지원</p>
                  
                  <input 
                    type="file" 
                    id="local-file-picker"
                    multiple
                    className="hidden" 
                    onChange={(e) => handleLocalFilesUpload(e.target.files)}
                  />
                </div>
              </div>

              {/* QUEUE MONITOR AREA */}
              {conversionQueue.length > 0 && (
                <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm flex-1 flex flex-col min-h-[300px]">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-150">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <span>실시간 변환 트래커</span>
                      <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded border border-indigo-100">
                        {conversionQueue.filter(q => q.status === "completed").length} / {conversionQueue.length} 완료
                      </span>
                    </h3>
                    
                    <button 
                      onClick={() => setConversionQueue([])}
                      disabled={isConverting}
                      className="text-[11px] text-slate-450 hover:text-slate-650 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-md hover:bg-slate-100 transition-colors disabled:opacity-50"
                    >
                      초기화
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto divide-y divide-slate-100 mt-2 pr-1 max-h-[350px]">
                    {conversionQueue.map((task) => (
                      <div key={task.id} className="py-3 text-left space-y-1.5">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="font-bold text-slate-800 truncate flex-1">{task.name}</span>
                          
                          {/* Task Badges */}
                          {task.status === "idle" && (
                            <span className="text-[10px] text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">대기중</span>
                          )}
                          {task.status === "downloading" && (
                            <span className="text-[10px] text-sky-650 bg-sky-50 px-2 py-0.5 rounded border border-sky-100 flex items-center gap-1">
                              <Loader2 className="w-2.5 h-2.5 animate-spin" /> 구글 드라이브 다운로드중
                            </span>
                          )}
                          {task.status === "uploading" && (
                            <span className="text-[10px] text-blue-650 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 flex items-center gap-1">
                              <Loader2 className="w-2.5 h-2.5 animate-spin" /> 구글 문서 가상 업로드중
                            </span>
                          )}
                          {task.status === "exporting" && (
                            <span className="text-[10px] text-indigo-650 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 flex items-center gap-1">
                              <Loader2 className="w-2.5 h-2.5 animate-spin" /> PDF 고화질 렌더링중
                            </span>
                          )}
                          {task.status === "completed" && (
                            <span className="text-[10px] text-emerald-650 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 flex items-center gap-1">
                              <CheckCircle className="w-3 h-3" /> 변환 및 다운로드 성공
                            </span>
                          )}
                          {task.status === "failed" && (
                            <span className="text-[10px] text-rose-650 bg-rose-50 px-2 py-0.5 rounded border border-rose-100 flex items-center gap-1">
                              <XCircle className="w-3 h-3" /> 실패
                            </span>
                          )}
                        </div>

                        {/* Progress Status Bar */}
                        <div className="relative w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div 
                            className={`absolute left-0 top-0 h-full rounded-full transition-all duration-300 ${
                              task.status === "completed" ? "bg-emerald-500 w-full" :
                              task.status === "failed" ? "bg-rose-500 w-full" :
                              task.status === "idle" ? "bg-slate-300 w-0" : "bg-indigo-500 w-[55%] animate-pulse"
                            }`}
                          />
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-slate-450">
                          <span>{task.progressText}</span>
                          {task.pdfUrl && (
                            <a 
                              href={task.pdfUrl} 
                              download={(() => {
                                let downloadName = task.name.replace(/\.[a-zA-Z0-9]+$/, "");
                                if (renameOnDownload) {
                                  const match = task.name.match(/(?<!\d)(\d{5})(?!\d)/);
                                  if (match) {
                                    downloadName = match[1];
                                  }
                                }
                                return `${downloadName}.pdf`;
                              })()}
                              className="text-indigo-600 hover:underline font-semibold flex items-center gap-1"
                            >
                              <Download className="w-3 h-3" /> 개별 재다운로드
                            </a>
                          )}
                        </div>

                        {task.error && (
                          <p className="text-[10px] text-rose-650 bg-rose-50/55 p-1.5 rounded border border-rose-100">
                            {task.error}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          </>
        )}

      </main>

      {/* HELP / INFORMATION MODAL */}
      <AnimatePresence>
        {showHelpModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl relative"
            >
              <h3 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-3">
                📚 Google Drive PDF Converter 가이드
              </h3>

              <div className="mt-4 space-y-4 text-sm text-slate-600 leading-relaxed text-left">
                <div>
                  <h4 className="font-bold text-slate-800">1. 한글 파일(.hwp) 지원 기술 원리</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    구글 드라이브 API는 한글 문서 파일을 Drive로 업로드하면서 Google Docs 타입 포맷으로 자동 번역하여 읽을 수 있습니다.이 변환 과정에서 생성된 구글 문서 템플릿 파일은 PDF 내보내기 엔진을 거쳐 고화질 PDF 결과물로 재해석되며, 임시 구글 문서는 파일 정보 노출 방지를 위해 사용자의 컴퓨터로 저장 완료되는 즉시 구글 드라이브에서 깔끔히 소멸됩니다!
                  </p>
                </div>

                <div>
                  <h4 className="font-bold text-slate-800">2. 파일 선택 및 일괄 가공</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    내 드라이브 속 임의의 폴더를 브라우즈 할 수 있으며, 최상위 선택 옵션을 통해 한 번에 여러 개의 문서를 담아 "일괄 PDF 변환기" 큐를 구동하고 연속 다운로드 트리거할 수 있습니다.
                  </p>
                </div>

                <div>
                  <h4 className="font-bold text-slate-800">3. 개인정보 보호 & 보안</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    우리의 서비스는 Firebase Auth를 통한 사용자 메모리 기반 인가 처리를 준수합니다. 어떠한 인증 키나 드라이브 자료도 외부 서버로 영구 백업되지 않습니다.
                  </p>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setShowHelpModal(false)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-5 py-2.5 rounded-xl transition-all text-xs"
                >
                  확인 후 닫기
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* BATCH RENAMING PROGRESS MODAL */}
      <AnimatePresence>
        {isRenaming && renameProgress && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-100 text-center space-y-4"
            >
              <Loader2 className="w-10 h-10 animate-spin text-indigo-650 mx-auto" />
              <div className="space-y-1">
                <h3 className="font-bold text-slate-900 text-sm">학번 파일명 일괄 변경 중...</h3>
                <p className="text-xs text-slate-500">Google Drive API를 통해 안전하게 파일명을 변경하고 있습니다.</p>
              </div>
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-left">
                <p className="text-[9px] text-slate-400 uppercase font-bold tracking-wider">처리 대상</p>
                <p className="text-xs font-semibold text-slate-700 truncate mt-0.5">{renameProgress.fileName}</p>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px] font-bold text-slate-500">
                  <span>진행도</span>
                  <span>{renameProgress.current} / {renameProgress.total}개 ({Math.round((renameProgress.current / renameProgress.total) * 100)}%)</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div 
                    className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(renameProgress.current / renameProgress.total) * 100}%` }}
                  ></div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* FOOTER */}
      <footer className="bg-white border-t border-slate-200 py-6 px-6 text-center text-xs text-slate-400">
        <p>© 2026 Google Workspace Drive API integration framework based on AI Studio.</p>
        <p className="mt-1">Designed by Google AI Studio agent with elegant components & Tailwind CSS.</p>
      </footer>

    </div>
  );
}
