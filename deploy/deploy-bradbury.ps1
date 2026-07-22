param(
  [switch]$SkipChecks
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$EnvPath = Join-Path $ProjectRoot ".env"
$FrontendEnvPath = Join-Path $ProjectRoot "frontend\.env"
$ContractPath = "contracts/verdict_proof.py"

function Read-LocalEnv {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    throw "Missing .env at $Path"
  }

  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if ($trimmed.Length -eq 0 -or $trimmed.StartsWith("#")) {
      continue
    }

    $parts = $trimmed.Split("=", 2)
    if ($parts.Count -eq 2) {
      $values[$parts[0].Trim()] = $parts[1].Trim()
    }
  }

  return $values
}

function Invoke-LoggedCommand {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string[]]$DisplayArguments = $Arguments,
    [string]$InputText = $null,
    [string]$WorkingDirectory = $ProjectRoot
  )

  function Quote-ProcessArgument {
    param([string]$Value)

    if ($null -eq $Value) {
      return '""'
    }

    if ($Value -notmatch '[\s"]') {
      return $Value
    }

    return '"' + ($Value -replace '\\(?=")', '\' -replace '"', '\"') + '"'
  }

  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $FilePath
  $psi.Arguments = ($Arguments | ForEach-Object { Quote-ProcessArgument $_ }) -join " "
  $psi.WorkingDirectory = $WorkingDirectory
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.RedirectStandardInput = $null -ne $InputText
  $psi.UseShellExecute = $false

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $psi
  [void]$process.Start()

  if ($null -ne $InputText) {
    $process.StandardInput.WriteLine($InputText)
    $process.StandardInput.Close()
  }

  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()

  $output = ($stdout + "`n" + $stderr).Trim()
  $script:LastCommandOutput = $output
  if ($output) {
    Write-Host $output
  }

  if ($process.ExitCode -ne 0) {
    throw "Command failed: $FilePath $($DisplayArguments -join ' ')"
  }

  return $output
}

function Find-ContractAddress {
  param([string]$DeployOutput)

  $preferred = $DeployOutput -split "`r?`n" | Where-Object {
    $_ -match "(?i)(contract|deployed|address)"
  } | ForEach-Object {
    [regex]::Match($_, "0x[a-fA-F0-9]{40}").Value
  } | Where-Object {
    $_
  } | Select-Object -Last 1

  if ($preferred) {
    return $preferred
  }

  $allAddresses = [regex]::Matches($DeployOutput, "0x[a-fA-F0-9]{40}") | ForEach-Object { $_.Value }
  return $allAddresses | Select-Object -Last 1
}

Set-Location -LiteralPath $ProjectRoot
$genlayerCommand = (Get-Command "genlayer.cmd" -ErrorAction Stop).Source

$envValues = Read-LocalEnv -Path $EnvPath
$privateKey = $envValues["ACCOUNT_PRIVATE_KEY"]
$expectedWallet = $envValues["EXPECTED_WALLET_ADDRESS"]
$accountName = $envValues["VERDICTPROOF_ACCOUNT_NAME"]
$accountPassword = $envValues["VERDICTPROOF_KEYSTORE_PASSWORD"]

if (-not $accountName) {
  $accountName = "verdictproof-bradbury"
}

if (-not $accountPassword) {
  $accountPassword = "verdictproof-local-deploy-password"
}

if (-not $privateKey -or $privateKey -eq "PASTE_PRIVATE_KEY_HERE") {
  throw "ACCOUNT_PRIVATE_KEY is empty. Put your Bradbury wallet private key in $EnvPath first."
}

if ($privateKey -notmatch "^0x[a-fA-F0-9]{64}$") {
  throw "ACCOUNT_PRIVATE_KEY must look like 0x followed by 64 hex characters."
}

if ($expectedWallet -and $expectedWallet -notmatch "^0x[a-fA-F0-9]{40}$") {
  throw "EXPECTED_WALLET_ADDRESS must look like a normal 0x wallet address, or leave it empty."
}

if (-not $SkipChecks) {
  Invoke-LoggedCommand -FilePath "genvm-lint" -Arguments @("check", $ContractPath, "--json") | Out-Null
  Invoke-LoggedCommand -FilePath "pytest" -Arguments @("tests/direct/", "-v") | Out-Null
  $npmCommand = (Get-Command "npm.cmd" -ErrorAction Stop).Source
  Invoke-LoggedCommand -FilePath $npmCommand -Arguments @("run", "build") -WorkingDirectory (Join-Path $ProjectRoot "frontend") | Out-Null
}

Invoke-LoggedCommand -FilePath $genlayerCommand -Arguments @("network", "set", "testnet-bradbury") | Out-Null

$accountListOutput = Invoke-LoggedCommand -FilePath $genlayerCommand -Arguments @("account", "list")
$accountExists = $accountListOutput -match [regex]::Escape($accountName)

if (-not $accountExists) {
  Invoke-LoggedCommand -FilePath $genlayerCommand -Arguments @(
    "account",
    "import",
    "--name",
    $accountName,
    "--private-key",
    $privateKey,
    "--password",
    $accountPassword
  ) -DisplayArguments @(
    "account",
    "import",
    "--name",
    $accountName,
    "--private-key",
    "<redacted>",
    "--password",
    "<redacted>"
  ) | Out-Null
} else {
  Write-Host "Account $accountName already exists; continuing."
}

Invoke-LoggedCommand -FilePath $genlayerCommand -Arguments @("account", "use", $accountName) | Out-Null
$accountOutput = Invoke-LoggedCommand -FilePath $genlayerCommand -Arguments @("account")

if ($expectedWallet -and $accountOutput -notmatch [regex]::Escape($expectedWallet)) {
  throw "Active account does not match EXPECTED_WALLET_ADDRESS=$expectedWallet. Stop before deploy."
}

$deployOutput = $null
for ($deployAttempt = 1; $deployAttempt -le 4; $deployAttempt++) {
  try {
    $deployOutput = Invoke-LoggedCommand -FilePath $genlayerCommand -Arguments @("deploy", "--contract", $ContractPath) -InputText $accountPassword
    break
  } catch {
    $isBackpressure = $script:LastCommandOutput -match "pipeline backpressure|not currently accepting transactions|l1_sender_commit"
    $hasTransactionHash = $script:LastCommandOutput -match "Transaction Hash"
    if (-not $isBackpressure -or $hasTransactionHash -or $deployAttempt -eq 4) {
      throw
    }
    $delaySeconds = 15 * $deployAttempt
    Write-Host "Bradbury pipeline backpressure; retrying deploy in $delaySeconds seconds."
    Start-Sleep -Seconds $delaySeconds
  }
}
$contractAddress = Find-ContractAddress -DeployOutput $deployOutput

if (-not $contractAddress) {
  throw "Deploy command completed but no contract address was detected. Inspect the output above before updating frontend env."
}

$frontendEnv = @(
  "VITE_VERDICTPROOF_CONTRACT_ADDRESS=$contractAddress",
  "VITE_VERDICTPROOF_CHAIN=bradbury",
  "VITE_GENLAYER_EXPLORER=https://explorer-bradbury.genlayer.com"
)

[System.IO.File]::WriteAllLines(
  $FrontendEnvPath,
  [string[]]$frontendEnv,
  [System.Text.UTF8Encoding]::new($false)
)

Write-Host ""
Write-Host "VerdictProof deployed on Bradbury."
Write-Host "Contract address: $contractAddress"
Write-Host "Frontend env written to: $FrontendEnvPath"
