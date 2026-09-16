export interface FileEditReplacement {
  old: string;
  new: string;
}

export interface FileOperation {
  action: 'read' | 'read_range' | 'count_rows' | 'write' | 'append' | 'edit_range' | 'edit' | 'delete' | 'delete_path' | 'list' | 'run_powershell' | 'grep' | 'move' | 'copy' | 'read_skill';
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
  replacements?: FileEditReplacement[];
}

export interface IFileOperationParser {
  parse(response: string): FileOperation[];
}
