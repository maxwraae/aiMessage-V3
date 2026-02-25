export type ToolCallData = {
  name: string;
  input: any;
  result?: any;
  status: "running" | "completed" | "failed";
};

export function getToolLabel(name: string, input: any): string {
  switch (name) {
    case "bash":
    case "shell":
    case "run_command":
      return `Shell: ${input.command || input.cmd || ""}`;
    case "read_file":
    case "read":
      return `Read: ${input.path || input.filepath || ""}`;
    case "write_file":
    case "write":
      return `Write: ${input.path || input.filepath || ""}`;
    case "edit_file":
    case "replace_content":
      return `Edit: ${input.path || input.filepath || ""}`;
    case "ls":
    case "list_files":
    case "list_directory":
      return `List: ${input.path || input.dir_path || "."}`;
    case "grep":
    case "search":
      return `Search: ${input.pattern || input.query || ""}`;
    default:
      return name;
  }
}
