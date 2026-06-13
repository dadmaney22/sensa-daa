param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("detect","stream","position")]
    [string]$Mode,

    [string]$DllPath = "C:\Program Files (x86)\Tobii\Tobii EyeX\tobii_stream_engine.dll",

    [int]$StimulusId = 1
)

$ErrorActionPreference = "Stop"

# ── Compile C# P/Invoke bindings for the Tobii Stream Engine DLL ──────────
# NOTE: The EyeX-era DLL uses the v3 API where tobii_device_create takes
#       3 params (no field_of_use).  We also declare the v4 variant and
#       pick the right one at runtime.

$escapedDll = $DllPath.Replace('\','\\')

$csharp = @"
using System;
using System.Runtime.InteropServices;

public static class Tobii
{
    public const int OK = 0;
    public const int TIMED_OUT = 6;
    public const int INTERACTIVE = 1;
    public const int VALID = 1;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public struct DeviceInfo
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string serial_number;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string model;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string generation;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string firmware_version;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct GazePoint
    {
        public long timestamp_us;
        public int validity;
        public float x;
        public float y;
    }

    // Gaze origin: per-eye XYZ in millimetres from the tracker. Z ~ distance.
    [StructLayout(LayoutKind.Sequential)]
    public struct GazeOrigin
    {
        public long timestamp_us;
        public int left_validity;
        public float left_x;
        public float left_y;
        public float left_z;
        public int right_validity;
        public float right_x;
        public float right_y;
        public float right_z;
    }

    // Eye position normalized: per-eye XYZ in track box [0,1]. Fallback for
    // older EyeX DLLs that lack gaze_origin.
    [StructLayout(LayoutKind.Sequential)]
    public struct EyePositionNormalized
    {
        public long timestamp_us;
        public int left_validity;
        public float left_x;
        public float left_y;
        public float left_z;
        public int right_validity;
        public float right_x;
        public float right_y;
        public float right_z;
    }

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate void UrlReceiver(IntPtr url, IntPtr userData);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate void GazeCallback(ref GazePoint gaze, IntPtr userData);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate void GazeOriginCallback(ref GazeOrigin origin, IntPtr userData);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    public delegate void EyePositionCallback(ref EyePositionNormalized pos, IntPtr userData);

    // --- Core lifecycle ---

    [DllImport("$escapedDll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int tobii_api_create(out IntPtr api, IntPtr a, IntPtr b);

    [DllImport("$escapedDll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int tobii_api_destroy(IntPtr api);

    // --- Enumeration ---

    [DllImport("$escapedDll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int tobii_enumerate_local_device_urls(IntPtr api, UrlReceiver cb, IntPtr ud);

    // --- Device (v3 API — 3 params, no field_of_use) ---

    [DllImport("$escapedDll", EntryPoint = "tobii_device_create",
               CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    public static extern int tobii_device_create_v3(IntPtr api, string url, out IntPtr device);

    // --- Device (v4 API — 4 params with field_of_use) ---

    [DllImport("$escapedDll", EntryPoint = "tobii_device_create",
               CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    public static extern int tobii_device_create_v4(IntPtr api, string url, int fieldOfUse, out IntPtr device);

    [DllImport("$escapedDll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int tobii_device_destroy(IntPtr device);

    [DllImport("$escapedDll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int tobii_get_device_info(IntPtr device, out DeviceInfo info);

    // --- Gaze subscription ---

    [DllImport("$escapedDll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int tobii_gaze_point_subscribe(IntPtr device, GazeCallback cb, IntPtr ud);

    [DllImport("$escapedDll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int tobii_gaze_point_unsubscribe(IntPtr device);

    // --- Gaze origin subscription (XYZ in mm) ---

    [DllImport("$escapedDll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int tobii_gaze_origin_subscribe(IntPtr device, GazeOriginCallback cb, IntPtr ud);

    [DllImport("$escapedDll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int tobii_gaze_origin_unsubscribe(IntPtr device);

    // --- Eye position normalized subscription (fallback, [0,1]) ---

    [DllImport("$escapedDll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int tobii_eye_position_normalized_subscribe(IntPtr device, EyePositionCallback cb, IntPtr ud);

    [DllImport("$escapedDll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int tobii_eye_position_normalized_unsubscribe(IntPtr device);

    // --- Callback processing ---

    [DllImport("$escapedDll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int tobii_wait_for_callbacks(int count, IntPtr[] devices);

    [DllImport("$escapedDll", CallingConvention = CallingConvention.Cdecl)]
    public static extern int tobii_device_process_callbacks(IntPtr device);
}
"@

Add-Type -TypeDefinition $csharp

# ── Helpers ───────────────────────────────────────────────────────────────

function New-Api {
    $ptr = [IntPtr]::Zero
    $ret = [Tobii]::tobii_api_create([ref]$ptr, [IntPtr]::Zero, [IntPtr]::Zero)
    if ($ret -ne [Tobii]::OK) { throw "tobii_api_create failed ($ret)" }
    return $ptr
}

function Find-DeviceUrl([IntPtr]$api) {
    $script:foundUrls = @()
    $receiver = [Tobii+UrlReceiver]{
        param([IntPtr]$urlPtr, [IntPtr]$ud)
        $script:foundUrls += [Runtime.InteropServices.Marshal]::PtrToStringAnsi($urlPtr)
    }
    $ret = [Tobii]::tobii_enumerate_local_device_urls($api, $receiver, [IntPtr]::Zero)
    if ($ret -ne [Tobii]::OK) { throw "enumerate failed ($ret)" }
    if ($script:foundUrls.Count -eq 0) { return $null }
    return $script:foundUrls[0]
}

function Connect-Device([IntPtr]$api, [string]$url) {
    $ptr = [IntPtr]::Zero

    # Try v3 API first (EyeX-era DLL, 3 params)
    try {
        $ret = [Tobii]::tobii_device_create_v3($api, $url, [ref]$ptr)
        if ($ret -eq [Tobii]::OK) { return $ptr }
    } catch {}

    # Fall back to v4 API (newer DLL, 4 params with field_of_use)
    $ptr = [IntPtr]::Zero
    $ret = [Tobii]::tobii_device_create_v4($api, $url, [Tobii]::INTERACTIVE, [ref]$ptr)
    if ($ret -ne [Tobii]::OK) { throw "device_create failed ($ret)" }
    return $ptr
}

# ── DETECT mode ───────────────────────────────────────────────────────────

if ($Mode -eq "detect") {
    try {
        $api = New-Api
        $url = Find-DeviceUrl $api
        if (-not $url) {
            Write-Output '{"connected":false}'
            [Tobii]::tobii_api_destroy($api) | Out-Null
            exit 0
        }
        $dev = Connect-Device $api $url
        $info = New-Object Tobii+DeviceInfo
        $ret = [Tobii]::tobii_get_device_info($dev, [ref]$info)
        $rawModel = if ($ret -eq [Tobii]::OK -and $info.model) { $info.model } else { "" }
        $serial = if ($ret -eq [Tobii]::OK -and $info.serial_number) { $info.serial_number } else { "" }
        $gen = if ($ret -eq [Tobii]::OK -and $info.generation) { $info.generation } else { "" }
        $fw = if ($ret -eq [Tobii]::OK -and $info.firmware_version) { $info.firmware_version } else { "" }

        # The v3 API sometimes puts firmware in the model field.  Derive a
        # friendly name from the serial prefix when possible.
        $model = switch -Wildcard ($serial) {
            "IS404*" { "Tobii Eye Tracker 4C" }
            "IS503*" { "Tobii Eye Tracker 5"  }
            "IS5*"   { "Tobii Eye Tracker 5"  }
            default  {
                if ($rawModel -match '^\d+\.\d+') { "Tobii Eye Tracker" }
                else { if ($rawModel) { $rawModel } else { "Tobii Eye Tracker" } }
            }
        }
        if (-not $fw -and $rawModel -match '^\d+\.\d+') { $fw = $rawModel }

        $json = @{
            connected = $true
            url = $url
            model = $model
            serial_number = $serial
            generation = $gen
            firmware_version = $fw
        } | ConvertTo-Json -Compress

        Write-Output $json

        [Tobii]::tobii_device_destroy($dev) | Out-Null
        [Tobii]::tobii_api_destroy($api) | Out-Null
    }
    catch {
        Write-Output ('{"connected":false,"error":"' + ($_.Exception.Message -replace '"','\"') + '"}')
        exit 1
    }
    exit 0
}

# ── STREAM mode ───────────────────────────────────────────────────────────

if ($Mode -eq "stream") {
    $api = New-Api
    $url = Find-DeviceUrl $api
    if (-not $url) {
        [Console]::Error.WriteLine("No Tobii device found")
        [Tobii]::tobii_api_destroy($api) | Out-Null
        exit 1
    }
    $dev = Connect-Device $api $url

    $stimId = $StimulusId

    $gazeCallback = [Tobii+GazeCallback]{
        param([ref]$gp, [IntPtr]$ud)
        $v = if ($gp.Value.validity -eq [Tobii]::VALID) { 1 } else { 0 }
        $x = $gp.Value.x
        $y = $gp.Value.y
        $ts = $gp.Value.timestamp_us
        $line = '{{"device_time_stamp":{0},"left_gaze_point_on_display_area":[{1},{2}],"right_gaze_point_on_display_area":[{1},{2}],"left_gaze_point_validity":{3},"right_gaze_point_validity":{3},"stimulus_id":{4}}}' -f $ts,$x,$y,$v,$stimId
        [Console]::Out.WriteLine($line)
        [Console]::Out.Flush()
    }

    $ret = [Tobii]::tobii_gaze_point_subscribe($dev, $gazeCallback, [IntPtr]::Zero)
    if ($ret -ne [Tobii]::OK) {
        [Console]::Error.WriteLine("gaze_point_subscribe failed ($ret)")
        [Tobii]::tobii_device_destroy($dev) | Out-Null
        [Tobii]::tobii_api_destroy($api) | Out-Null
        exit 1
    }

    # Signal readiness
    [Console]::Out.WriteLine('{"status":"streaming"}')
    [Console]::Out.Flush()

    # Build an IntPtr[] with a single element for tobii_wait_for_callbacks
    $devArray = New-Object 'IntPtr[]' 1
    $devArray[0] = $dev

    try {
        while ($true) {
            # Use a short sleep + process_callbacks loop instead of
            # wait_for_callbacks, which has marshalling issues in PS.
            [Tobii]::tobii_device_process_callbacks($dev) | Out-Null
            Start-Sleep -Milliseconds 10
        }
    }
    finally {
        [Tobii]::tobii_gaze_point_unsubscribe($dev) | Out-Null
        [Tobii]::tobii_device_destroy($dev) | Out-Null
        [Tobii]::tobii_api_destroy($api) | Out-Null
    }
    exit 0
}

# ── POSITION mode (per-eye XYZ for distance/presence) ──────────────────────

if ($Mode -eq "position") {
    $api = New-Api
    $url = Find-DeviceUrl $api
    if (-not $url) {
        [Console]::Error.WriteLine("No Tobii device found")
        [Tobii]::tobii_api_destroy($api) | Out-Null
        exit 1
    }
    $dev = Connect-Device $api $url

    # Try gaze_origin (mm) first; fall back to eye_position_normalized ([0,1]).
    $useNormalized = $false

    $originCallback = [Tobii+GazeOriginCallback]{
        param([ref]$o, [IntPtr]$ud)
        $lv = if ($o.Value.left_validity -eq [Tobii]::VALID) { 1 } else { 0 }
        $rv = if ($o.Value.right_validity -eq [Tobii]::VALID) { 1 } else { 0 }
        $line = '{{"left_xyz":[{0},{1},{2}],"right_xyz":[{3},{4},{5}],"left_valid":{6},"right_valid":{7},"normalized":false}}' -f `
            $o.Value.left_x,$o.Value.left_y,$o.Value.left_z,$o.Value.right_x,$o.Value.right_y,$o.Value.right_z,$lv,$rv
        [Console]::Out.WriteLine($line)
        [Console]::Out.Flush()
    }

    $posCallback = [Tobii+EyePositionCallback]{
        param([ref]$p, [IntPtr]$ud)
        $lv = if ($p.Value.left_validity -eq [Tobii]::VALID) { 1 } else { 0 }
        $rv = if ($p.Value.right_validity -eq [Tobii]::VALID) { 1 } else { 0 }
        $line = '{{"left_xyz":[{0},{1},{2}],"right_xyz":[{3},{4},{5}],"left_valid":{6},"right_valid":{7},"normalized":true}}' -f `
            $p.Value.left_x,$p.Value.left_y,$p.Value.left_z,$p.Value.right_x,$p.Value.right_y,$p.Value.right_z,$lv,$rv
        [Console]::Out.WriteLine($line)
        [Console]::Out.Flush()
    }

    $ret = -1
    try {
        $ret = [Tobii]::tobii_gaze_origin_subscribe($dev, $originCallback, [IntPtr]::Zero)
    } catch { $ret = -1 }

    if ($ret -ne [Tobii]::OK) {
        # Fall back to normalized eye position
        try {
            $ret = [Tobii]::tobii_eye_position_normalized_subscribe($dev, $posCallback, [IntPtr]::Zero)
            $useNormalized = $true
        } catch { $ret = -1 }
    }

    if ($ret -ne [Tobii]::OK) {
        [Console]::Error.WriteLine("position subscribe failed ($ret)")
        [Tobii]::tobii_device_destroy($dev) | Out-Null
        [Tobii]::tobii_api_destroy($api) | Out-Null
        exit 1
    }

    [Console]::Out.WriteLine('{"status":"streaming"}')
    [Console]::Out.Flush()

    try {
        while ($true) {
            [Tobii]::tobii_device_process_callbacks($dev) | Out-Null
            Start-Sleep -Milliseconds 10
        }
    }
    finally {
        if ($useNormalized) {
            [Tobii]::tobii_eye_position_normalized_unsubscribe($dev) | Out-Null
        } else {
            [Tobii]::tobii_gaze_origin_unsubscribe($dev) | Out-Null
        }
        [Tobii]::tobii_device_destroy($dev) | Out-Null
        [Tobii]::tobii_api_destroy($api) | Out-Null
    }
    exit 0
}
