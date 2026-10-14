<#
.SYNOPSIS
  Presses one button of one window of one process, found through Windows UI Automation.

.DESCRIPTION
  scripts/update-e2e.cjs runs this to answer the updater's "Update ready" prompt in an installed build, which
  has no test hooks:

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ui-answer.ps1 -ProcessId <pid> -Title 'Update ready' -Button 'Later'

  Windows PowerShell 5.1 and System.Windows.Automation only: nothing is compiled, and no key or mouse input is
  sent to the desktop. The window is the one named -Title that belongs to -ProcessId: a top-level window of that
  process, or a window it owns, which UI Automation lists as a child of its owner (a message box is owned by the
  window it was opened for). The button is the element named -Button inside that window.

  A button whose element supports InvokePattern is invoked through it. An Electron message box is a Windows task
  dialog, and its host answers UI Automation for each button with a pane (class CCPushButton) that supports no
  control pattern at all (measured on Electron 43 and Windows 11). Each of those buttons is still a Win32 Button
  window, so the script invokes it through the provider UI Automation's own client-side proxies use for Win32
  buttons (MS.Internal.AutomationProxies.WindowsButton in UIAutomationClientsideProviders, the assembly
  System.Windows.Automation loads for Win32 controls), after checking that the provider sees a button with the
  same name.

  Waits up to -TimeoutSeconds for the window and the button to appear, then up to 5 s for the window to close
  after the press.

  Exit codes: 0 pressed, and the window closed; 1 no such window with such a button within -TimeoutSeconds, or
  the button could not be pressed; 2 pressed, but the window was still open 5 s later.
#>
param(
  [Parameter(Mandatory = $true)] [int] $ProcessId,
  [Parameter(Mandatory = $true)] [string] $Title,
  [Parameter(Mandatory = $true)] [string] $Button,
  [int] $TimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName UIAutomationProvider

$AE = [System.Windows.Automation.AutomationElement]
$Scope = [System.Windows.Automation.TreeScope]
$CT = [System.Windows.Automation.ControlType]

# How long the window may stay open after the press: a declared bound, not a measured duration.
$CloseWaitSeconds = 5

function New-PropertyCondition($property, $value) {
  return New-Object System.Windows.Automation.PropertyCondition($property, $value)
}

$ofProcess = New-PropertyCondition $AE::ProcessIdProperty $ProcessId
$windowCondition = [System.Windows.Automation.AndCondition]::new([System.Windows.Automation.Condition[]] @(
    $ofProcess,
    (New-PropertyCondition $AE::ControlTypeProperty $CT::Window),
    (New-PropertyCondition $AE::NameProperty $Title)
  ))
$buttonCondition = New-PropertyCondition $AE::NameProperty $Button

# The window named $Title of the process: top-level, or owned by one of its top-level windows. $null if none.
function Find-TargetWindow {
  foreach ($top in $AE::RootElement.FindAll($Scope::Children, $ofProcess)) {
    if ($top.Current.ControlType -eq $CT::Window -and $top.Current.Name -eq $Title) { return $top }
    $owned = $top.FindFirst($Scope::Children, $windowCondition)
    if ($null -ne $owned) { return $owned }
  }
  return $null
}

# Written straight to stdout: a Fail inside a function whose output is being captured must still be seen.
function Fail([string] $message) {
  [Console]::Out.WriteLine("ui-answer: ERROR $message")
  exit 1
}

# Presses a button element that supports no pattern through UI Automation's Win32 button provider.
function Invoke-Win32Button($element) {
  $handle = [IntPtr] $element.Current.NativeWindowHandle
  if ($handle -eq [IntPtr]::Zero) { Fail "the button '$Button' supports no InvokePattern and has no window handle" }
  $flags = [System.Reflection.BindingFlags] 'Static,Public,NonPublic'
  $proxies = [System.Reflection.Assembly]::Load('UIAutomationClientsideProviders, Version=4.0.0.0, Culture=neutral, PublicKeyToken=31bf3856ad364e35')
  $type = $proxies.GetType('MS.Internal.AutomationProxies.WindowsButton')
  if ($null -eq $type) { Fail 'UIAutomationClientsideProviders has no WindowsButton provider' }
  $create = $type.GetMethod('Create', $flags, $null, [Type[]] @([IntPtr], [int], [int]), $null)
  if ($null -eq $create) { Fail 'the WindowsButton provider has no Create(IntPtr, int, int)' }
  $provider = $create.Invoke($null, @($handle, 0, 0))
  $getProperty = [System.Windows.Automation.Provider.IRawElementProviderSimple].GetMethod('GetPropertyValue')
  $name = $getProperty.Invoke($provider, @([int] $AE::NameProperty.Id))
  $controlType = $getProperty.Invoke($provider, @([int] $AE::ControlTypeProperty.Id))
  $isButton = (($controlType -is [int]) -and $controlType -eq $CT::Button.Id) -or
    (($controlType -is [System.Windows.Automation.ControlType]) -and $controlType.Id -eq $CT::Button.Id)
  if ($name -ne $Button -or -not $isButton) {
    Fail "window $handle is not the button '$Button' to the Win32 button provider (name '$name', control type '$controlType')"
  }
  $invoke = $provider -as [System.Windows.Automation.Provider.IInvokeProvider]
  if ($null -eq $invoke) { Fail "the Win32 button provider cannot invoke window $handle" }
  $invoke.Invoke()
  return "the Win32 button provider's InvokePattern on window $handle"
}

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$window = $null
$target = $null
while ($true) {
  try {
    $window = Find-TargetWindow
    $target = $null
    if ($null -ne $window) { $target = $window.FindFirst($Scope::Descendants, $buttonCondition) }
  } catch [System.Windows.Automation.ElementNotAvailableException] {
    $window = $null
    $target = $null
  }
  if ($null -ne $target) { break }
  if ((Get-Date) -ge $deadline) { Fail "no window '$Title' with a button '$Button' in process $ProcessId within $TimeoutSeconds s" }
  Start-Sleep -Milliseconds 250
}

Write-Output ("ui-answer: found window '{0}' (class {1}) of process {2}, and in it '{3}' (class {4})" -f `
    $window.Current.Name, $window.Current.ClassName, $ProcessId, $target.Current.Name, $target.Current.ClassName)

$pattern = $null
if ($target.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref] $pattern)) {
  $pattern.Invoke()
  $how = 'InvokePattern'
} else {
  $how = Invoke-Win32Button $target
}
Write-Output "ui-answer: pressed '$Button' through $how"

$closeDeadline = (Get-Date).AddSeconds($CloseWaitSeconds)
while ((Get-Date) -lt $closeDeadline) {
  $open = $null
  try { $open = Find-TargetWindow } catch [System.Windows.Automation.ElementNotAvailableException] { $open = $null }
  if ($null -eq $open) {
    Write-Output "ui-answer: the window '$Title' closed"
    exit 0
  }
  Start-Sleep -Milliseconds 100
}
Write-Output "ui-answer: ERROR the window '$Title' was still open $CloseWaitSeconds s after the press"
exit 2
