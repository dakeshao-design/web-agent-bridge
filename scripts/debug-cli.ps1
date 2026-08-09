param(
  [Parameter(Position = 0)]
  [string]$Command = "help",
  [Parameter(Position = 1)]
  [string]$Arg1 = "",
  [Parameter(Position = 2)]
  [string]$Arg2 = ""
)

$BaseUrl = if ($env:DEBUG_PORT) { "http://127.0.0.1:$($env:DEBUG_PORT)" } else { "http://127.0.0.1:9781" }
$StepDelayMs = if ($env:DEBUG_STEP_DELAY_MS) { [int]$env:DEBUG_STEP_DELAY_MS } else { 2000 }

function Wait-DebugStep {
  if ($StepDelayMs -gt 0) {
    Start-Sleep -Milliseconds $StepDelayMs
  }
}

function Invoke-DebugGet($Path) {
  $result = Invoke-RestMethod -Uri "$BaseUrl$Path" -Method Get
  Wait-DebugStep
  return $result
}

function Invoke-DebugPost($Path, $Body) {
  $json = $Body | ConvertTo-Json -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $response = Invoke-WebRequest `
    -Uri "$BaseUrl$Path" `
    -Method Post `
    -ContentType "application/json; charset=utf-8" `
    -Body $bytes `
    -UseBasicParsing
  Wait-DebugStep
  if ($response.Content) {
    return $response.Content | ConvertFrom-Json
  }
  return $null
}

switch ($Command.ToLower()) {
  "help" {
    Invoke-DebugGet "/debug/help" | Out-String
  }
  "status" {
    Invoke-DebugGet "/debug/status" | ConvertTo-Json -Depth 8
  }
  "click" {
    if (-not $Arg1) { throw "usage: click <action>" }
    Invoke-DebugPost "/debug/click" @{ action = $Arg1 } | ConvertTo-Json -Depth 8
  }
  "select-agent" {
    if (-not $Arg1) { throw "usage: select-agent <agentId>" }
    Invoke-DebugPost "/debug/select-agent" @{ agentId = $Arg1 } | ConvertTo-Json -Depth 8
  }
  "open-folder" {
    if ($Arg1) {
      Invoke-DebugPost "/debug/open-folder" @{ path = $Arg1 } | ConvertTo-Json -Depth 8
    } else {
      Invoke-DebugPost "/debug/open-folder" @{} | ConvertTo-Json -Depth 8
    }
  }
  "send-prompt" {
    if (-not $Arg1) { throw "usage: send-prompt <text> [agentId]" }
    $body = @{ text = $Arg1 }
    if ($Arg2) { $body.agentId = $Arg2 }
    Invoke-DebugPost "/debug/send-prompt" $body | ConvertTo-Json -Depth 8
  }
  "agent-dom" {
    $agentId = if ($Arg1) { $Arg1 } else { "example" }
    Invoke-DebugGet "/debug/agent-dom?agentId=$agentId" | ConvertTo-Json -Depth 12
  }
  "conversation" {
    $agentId = if ($Arg1) { $Arg1 } else { "example" }
    Invoke-DebugGet "/debug/conversation?agentId=$agentId" | ConvertTo-Json -Depth 12
  }
  "reset-sync" {
    $agentId = if ($Arg1) { $Arg1 } else { "example" }
    Invoke-DebugPost "/debug/reset-sync" @{ agentId = $agentId } | ConvertTo-Json -Depth 8
  }
  "bridge-response" {
    $agentId = if ($Arg1) { $Arg1 } else { "example" }
    Invoke-DebugGet "/debug/bridge-response?agentId=$agentId" | ConvertTo-Json -Depth 12
  }
  "last-file-op" {
    Invoke-DebugGet "/debug/last-file-op" | ConvertTo-Json -Depth 8
  }
  "flow-read" {
    $folder = if ($Arg1) { $Arg1 } else { "C:\work\test-editor" }
    $agentId = if ($Arg2) { $Arg2 } else { "example" }
    $waitAgentModeMs = if ($env:DEBUG_FLOW_AGENT_WAIT_MS) { [int]$env:DEBUG_FLOW_AGENT_WAIT_MS } else { 15000 }
    $waitReplyMs = if ($env:DEBUG_FLOW_REPLY_WAIT_MS) { [int]$env:DEBUG_FLOW_REPLY_WAIT_MS } else { 12000 }

    Invoke-DebugPost "/debug/open-folder" @{ path = $folder } | Out-Null
    Invoke-DebugPost "/debug/select-agent" @{ agentId = $agentId } | Out-Null
    Start-Sleep -Milliseconds 1000
    Invoke-DebugPost "/debug/click" @{ action = "agent-mode" } | Out-Null
    Write-Host "Waiting ${waitAgentModeMs}ms for Agent mode reply..."
    Start-Sleep -Milliseconds $waitAgentModeMs
    Invoke-DebugPost "/debug/send-prompt" @{ text = "read new-file.txt"; agentId = $agentId } | Out-Null
    Write-Host "Waiting ${waitReplyMs}ms for read reply..."
    Start-Sleep -Milliseconds $waitReplyMs
    Invoke-DebugGet "/debug/conversation?agentId=$agentId" | ConvertTo-Json -Depth 12
    Invoke-DebugGet "/debug/last-file-op" | ConvertTo-Json -Depth 8
    $logPath = Join-Path $folder ".agent-editor\logs"
    if (Test-Path $logPath) {
      Write-Host "`n--- conversation log tail ---"
      Get-ChildItem $logPath -Filter "agent-chat-*.log" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1 |
        ForEach-Object { Get-Content $_.FullName -Tail 30 -Encoding UTF8 }
    }
  }
  default {
    throw "unknown command: $Command"
  }
}
