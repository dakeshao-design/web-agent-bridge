/** Agent 工具 read_file / read_file_range / count_file_rows / write_file / append_file / edit_file_range / delete_file / delete_path / ls / grep / move_path / copy_path / run_powershell 的底层文件操作 */
export interface IFileService {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  append(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  deletePath(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  list(dir: string): Promise<string[]>;
  listFiles(dir: string, deep?: boolean): Promise<string[]>;
}
