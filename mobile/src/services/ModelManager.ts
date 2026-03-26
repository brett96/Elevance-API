import * as FileSystem from "expo-file-system";

export type ModelDownloadProgress = {
  totalBytesWritten: number;
  totalBytesExpectedToWrite: number;
  percentage: number;
};

export class ModelManager {
  static modelsDir(): string {
    const base = FileSystem.documentDirectory;
    if (!base) throw new Error("FileSystem.documentDirectory is not available.");
    return `${base}models/`;
  }

  static modelPath(filename: string): string {
    return `${ModelManager.modelsDir()}${filename}`;
  }

  static async ensureModelsDir(): Promise<void> {
    const dir = ModelManager.modelsDir();
    const info = await FileSystem.getInfoAsync(dir);
    if (info.exists && info.isDirectory) return;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }

  static async isModelPresent(filename: string): Promise<boolean> {
    const path = ModelManager.modelPath(filename);
    const info = await FileSystem.getInfoAsync(path);
    return info.exists && !info.isDirectory;
  }

  static async downloadModel(params: {
    url: string;
    filename: string;
    onProgress?: (p: ModelDownloadProgress) => void;
  }): Promise<{ path: string }> {
    const { url, filename, onProgress } = params;
    if (!url.startsWith("https://")) {
      throw new Error("Model URL must be https://");
    }

    await ModelManager.ensureModelsDir();
    const path = ModelManager.modelPath(filename);

    const callback: FileSystem.DownloadProgressCallback | undefined = onProgress
      ? (dp) => {
          const percentage =
            dp.totalBytesExpectedToWrite > 0
              ? Math.round((dp.totalBytesWritten / dp.totalBytesExpectedToWrite) * 1000) / 10
              : 0;
          onProgress({
            totalBytesWritten: dp.totalBytesWritten,
            totalBytesExpectedToWrite: dp.totalBytesExpectedToWrite,
            percentage,
          });
        }
      : undefined;

    const dl = FileSystem.createDownloadResumable(url, path, {}, callback);
    const res = await dl.downloadAsync();
    if (!res?.uri) throw new Error("Download failed: no URI returned.");
    return { path: res.uri };
  }

  static async ensureModel(params: {
    url: string;
    filename: string;
    onProgress?: (p: ModelDownloadProgress) => void;
  }): Promise<{ path: string; downloaded: boolean }> {
    const { url, filename, onProgress } = params;
    if (await ModelManager.isModelPresent(filename)) {
      return { path: ModelManager.modelPath(filename), downloaded: false };
    }
    const { path } = await ModelManager.downloadModel({ url, filename, onProgress });
    return { path, downloaded: true };
  }
}

