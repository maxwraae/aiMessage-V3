# aiMessage Skills

You have access to the following project-specific skills:

## `send_notification`
Use this tool to nudge the user when a long-running task is complete or when you require immediate attention. This will trigger a blue glowing ring in the user's sidebar.

**Parameters:**
- `message`: (string) The text to display in the notification.
- `priority`: (optional, "high" | "low") Defaults to "low".

**Example:**
```json
{
  "name": "send_notification",
  "arguments": {
    "message": "I have finished analyzing the logs.",
    "priority": "high"
  }
}
```
