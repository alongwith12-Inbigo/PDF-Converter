import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from "firebase/auth";
import firebaseConfig from "../../firebase-applet-config.json";

// Initialize Firebase App
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Use Google Auth Provider
export const provider = new GoogleAuthProvider();
provider.addScope("https://www.googleapis.com/auth/drive.readonly");
provider.addScope("https://www.googleapis.com/auth/drive.file");

let isSigningIn = false;
let cachedAccessToken: string | null = typeof window !== "undefined" ? localStorage.getItem("gdrive_access_token") : null;

// Initialize auth state listener.
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (!cachedAccessToken) {
        cachedAccessToken = localStorage.getItem("gdrive_access_token");
      }
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else {
        // Fallback to signin popup if cached is lost but user is logged in
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      localStorage.removeItem("gdrive_access_token");
      if (onAuthFailure) onAuthFailure();
    }
  });
};

// Google Sign-In
export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("Failed to get access token from Firebase Auth");
    }

    cachedAccessToken = credential.accessToken;
    localStorage.setItem("gdrive_access_token", cachedAccessToken);
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error("Sign in error:", error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

// Logout
export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
  localStorage.removeItem("gdrive_access_token");
};

export const clearCachedToken = () => {
  cachedAccessToken = null;
  localStorage.removeItem("gdrive_access_token");
};

export const getAccessToken = (): string | null => {
  if (!cachedAccessToken && typeof window !== "undefined") {
    cachedAccessToken = localStorage.getItem("gdrive_access_token");
  }
  return cachedAccessToken;
};

export const setAccessToken = (token: string) => {
  cachedAccessToken = token;
  localStorage.setItem("gdrive_access_token", token);
};

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  iconLink?: string;
  size?: string;
  createdTime?: string;
  parents?: string[];
}

// Fetch Drive files or folders
export const fetchDriveFiles = async (
  accessToken: string,
  folderId: string = "root",
  searchTerm: string = ""
): Promise<DriveFile[]> => {
  let query = "";
  
  if (searchTerm) {
    // If searching, search globally for files that match mimeTypes OR name
    query = `trashed = false and (name contains '${searchTerm}') and (mimeType = 'application/vnd.google-apps.folder' or mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/vnd.google-apps.presentation' or mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' or name contains '.hwp' or name contains '.docx' or mimeType = 'application/pdf')`;
  } else {
    // Regular directory listing
    query = `'${folderId}' in parents and trashed = false and (mimeType = 'application/vnd.google-apps.folder' or mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/vnd.google-apps.presentation' or mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' or name contains '.hwp' or name contains '.docx' or mimeType = 'application/pdf')`;
  }

  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,iconLink,size,createdTime,parents)&orderBy=name&pageSize=150`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error?.message || `Failed to fetch files: ${res.status}`);
  }

  const data = await res.json();
  const files: DriveFile[] = data.files || [];

  // Client-side sort: directories first, then files alphabetically
  return [...files].sort((a, b) => {
    const aIsFolder = a.mimeType === "application/vnd.google-apps.folder";
    const bIsFolder = b.mimeType === "application/vnd.google-apps.folder";
    if (aIsFolder && !bIsFolder) return -1;
    if (!aIsFolder && bIsFolder) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
};

// Fetch folders for parent breadcrumbs
export const fetchFolderName = async (accessToken: string, folderId: string): Promise<string> => {
  if (folderId === "root") return "내 드라이브";
  const url = `https://www.googleapis.com/drive/v3/files/${folderId}?fields=name`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) return "폴더";
  const data = await res.json();
  return data.name || "폴더";
};

// Download raw blob from drive
export const downloadDriveFileBlob = async (accessToken: string, fileId: string): Promise<Blob> => {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error(`파일 수신 중 드라이브 오류 발생: ${res.status}`);
  }

  return await res.blob();
};

// Direct conversion for Google Docs formats (Docs, Sheets, Slides)
export const exportGoogleDocToPdf = async (accessToken: string, fileId: string): Promise<Blob> => {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Google 드라이브 PDF 변환 변환기 오류: ${res.status}`);
  }

  return await res.blob();
};

// Multipart upload to Drive, automatically turning files like .hwp into Google Docs
export const uploadAndConvertToGoogleDoc = async (
  accessToken: string,
  fileName: string,
  fileBlob: Blob
): Promise<string> => {
  const boundary = "hwp_pdf_converter_boundary";
  const metadata = {
    name: `[변환 대기] ${fileName}`,
    mimeType: "application/vnd.google-apps.document", // This triggers conversion to Google Docs
  };

  const metadataPart = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    "",
  ].join("\r\n");

  const headerBlob = new Blob([metadataPart], { type: "text/plain" });
  const footerBlob = new Blob([`\r\n--${boundary}--`], { type: "text/plain" });
  
  // Combine all parts into related form
  const multipartBody = new Blob([headerBlob, fileBlob, footerBlob], {
    type: `multipart/related; boundary=${boundary}`,
  });

  const url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: multipartBody,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error?.message || `구글 문서 변환용 파일 업로드에 실패했습니다: ${res.status}`);
  }

  const data = await res.json();
  return data.id; // Return the converted doc fileId
};

// Delete temporary file
export const deleteDriveFile = async (accessToken: string, fileId: string): Promise<void> => {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}`;
  await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
};
