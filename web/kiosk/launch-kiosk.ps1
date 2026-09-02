# Launch the lobby kiosk in Chrome.
#
# Run from Task Scheduler at logon (not from a shortcut) so it survives reboots.
# See KIOSK_SETUP.md for the one-time microphone grant, which this script
# deliberately does NOT try to automate - it is a policy/profile concern and
# faking it with --use-fake-ui-for-media-stream hides real failures.

param(
  [string]$Url     = "https://web-cortif-ai.vercel.app/kiosk",
  [string]$Profile = "C:\kiosk-profile",
  [switch]$Debug
)

$chrome = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chrome) { Write-Error "Chrome not found"; exit 1 }
if (-not (Test-Path $Profile)) { New-Item -ItemType Directory -Force $Profile | Out-Null }
if ($Debug) { $Url = "$Url" + $(if ($Url -match '\?') { '&' } else { '?' }) + "debug=1" }

$chromeArgs = @(
  "--kiosk",
  "--app=$Url",
  "--user-data-dir=$Profile",
  # Removes the user-gesture requirement for audio outright. Without this a
  # machine that boots unattended can never make a sound.
  "--autoplay-policy=no-user-gesture-required",
  "--disable-features=CalculateNativeWinOcclusion,Translate",
  # A kiosk tab is never foregrounded by a human; without these Chrome throttles
  # its timers and the avatar stutters or stops animating entirely.
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--disable-session-crashed-bubble",
  "--disable-infobars",
  "--noerrdialogs",
  "--check-for-update-interval=31536000"
)

Write-Host "Launching kiosk: $Url"
& $chrome @chromeArgs
