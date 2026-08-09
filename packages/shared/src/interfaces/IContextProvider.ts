export interface FileContext {
  path: string;
  content: string;
  signatures?: string[];
}

export interface IContextProvider {
  getCurrentFile(): FileContext | null;
  getSelectedText(): string | null;
  getWorkspaceFiles(maxCount: number): Promise<FileContext[]>;
}
