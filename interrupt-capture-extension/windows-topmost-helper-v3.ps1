param([Parameter(Mandatory = $true)][int]$ParentProcessId)

$ErrorActionPreference = "Stop"
$mutex = New-Object System.Threading.Mutex($false, "Local\InterruptCaptureTopmostHelperV3")
$ownsMutex = $false
$nativeSource = @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class InterruptCaptureTopmostV3 {
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
  private static readonly IntPtr Topmost = new IntPtr(-1);
  private const uint Flags = 0x0001 | 0x0002 | 0x0010 | 0x0040;
  private const string ReminderTitle = "\u8BE5\u56DE\u6765\u4E86";

  public static void PinMatchingWindows() {
    EnumWindows((hWnd, state) => {
      if (!IsWindowVisible(hWnd)) return true;
      var title = new StringBuilder(512);
      GetWindowText(hWnd, title, title.Capacity);
      if (!title.ToString().StartsWith(ReminderTitle, StringComparison.Ordinal)) return true;
      uint processId;
      GetWindowThreadProcessId(hWnd, out processId);
      try {
        var name = Process.GetProcessById((int)processId).ProcessName.ToLowerInvariant();
        if (name != "chrome" && name != "msedge" && name != "brave" && name != "vivaldi" && name != "opera") return true;
      } catch { return true; }
      SetWindowPos(hWnd, Topmost, 0, 0, 0, 0, Flags);
      return true;
    }, IntPtr.Zero);
  }
}
"@

try {
  $ownsMutex = $mutex.WaitOne(0, $false)
  if (-not $ownsMutex) { exit 0 }
  Add-Type -TypeDefinition $nativeSource
  while (Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue) {
    [InterruptCaptureTopmostV3]::PinMatchingWindows()
    Start-Sleep -Milliseconds 750
  }
} finally {
  if ($ownsMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
