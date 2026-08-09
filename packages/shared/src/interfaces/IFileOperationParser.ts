export interface FileOperation {
  action: 'read' | 'read_range' | 'count_rows' | 'write' | 'append' | 'edit_range' | 'delete' | 'delete_path' | 'list' | 'run_powershell' | 'grep' | 'move' | 'copy';
  path: string;
  content?: string;
  deep?: boolean;
  command?: string;
  start_line?: number;
  end_line?: number;
  pattern?: string;
  regex?: boolean;
  case_insensitive?: boolean;
  glob?: string;
  head_limit?: number;
  offset?: number;
  dest?: string;
}

export interface IFileOperationParser {
  parse(response: string): FileOperation[];
}
