//! Batería y WiFi. Un hilo ligero consulta cada 60 s y SOLO emite el evento IPC
//! `sys-status` cuando algún valor cambia (típico: 0-2 eventos/hora => CPU ~0%).

use serde::Serialize;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone, PartialEq)]
pub struct SysStatus {
    pub battery: Option<u8>,   // % 0-100
    pub charging: bool,
    pub wifi: Option<u32>,     // % 0-100
}

#[cfg(windows)]
fn read() -> SysStatus {
    use windows::Win32::System::Power::GetSystemPowerStatus;
    use windows::Win32::System::Power::SYSTEM_POWER_STATUS;

    let mut ps = SYSTEM_POWER_STATUS::default();
    unsafe {
        if GetSystemPowerStatus(&mut ps).is_ok() {
            let battery = if ps.BatteryLifePercent != 255 && (ps.BatteryFlag & 128) == 0 {
                Some(ps.BatteryLifePercent)
            } else {
                None
            };
            let charging = (ps.BatteryFlag & 8) != 0 || ps.ACLineStatus == 1;
            return SysStatus { battery, charging, wifi: wifi_strength() };
        }
    }
    SysStatus { battery: None, charging: false, wifi: wifi_strength() }
}

#[cfg(windows)]
fn wifi_strength() -> Option<u32> {
    // WLAN_SIGNAL_QUALITY ya viene en % (0-100). Si no hay interfaz WLAN activa
    // (p. ej. solo Ethernet) devuelve None y la isla oculta el icono.
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::NetworkManagement::WiFi::{
        WLAN_INTERFACE_INFO_LIST, WlanCloseHandle, WlanEnumInterfaces, WlanFreeMemory,
        WlanOpenHandle, WlanQueryInterface, WLAN_CONNECTION_ATTRIBUTES,
    };
    use windows::Win32::NetworkManagement::WiFi::{
        wlan_interface_state_connected, wlan_intf_opcode_current_connection,
    };
    use windows::core::GUID;

    unsafe {
        let mut negotiated = 0u32;
        let mut handle = HANDLE::default();
        if WlanOpenHandle(2, None, &mut negotiated, &mut handle) != 0 {
            return None;
        }
        let result = (|| {
            let mut list: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
            if WlanEnumInterfaces(handle, None, &mut list) != 0 || list.is_null() {
                return None;
            }
            let count = (*list).dwNumberOfItems as usize;
            let items = std::slice::from_raw_parts((*list).InterfaceInfo.as_ptr(), count);
            let mut found = None;
            for it in items {
                if it.isState != wlan_interface_state_connected {
                    continue;
                }
                let mut data: *mut core::ffi::c_void = std::ptr::null_mut();
                let mut size = 0u32;
                let ok = WlanQueryInterface(
                    handle,
                    &it.InterfaceGuid as *const GUID,
                    wlan_intf_opcode_current_connection,
                    None,
                    &mut size,
                    &mut data,
                    None,
                );
                if ok == 0 && !data.is_null()
                    && size as usize >= std::mem::size_of::<WLAN_CONNECTION_ATTRIBUTES>()
                {
                    let attrs = &*(data as *const WLAN_CONNECTION_ATTRIBUTES);
                    found = Some(attrs.wlanAssociationAttributes.wlanSignalQuality as u32);
                }
                if !data.is_null() {
                    WlanFreeMemory(data);
                }
                if found.is_some() {
                    break;
                }
            }
            WlanFreeMemory(list.cast());
            found
        })();
        WlanCloseHandle(handle, None);
        result
    }
}

#[cfg(target_os = "linux")]
fn read() -> SysStatus {
    let (battery, charging) = read_linux_power(std::path::Path::new("/sys/class/power_supply"));
    SysStatus { battery, charging, wifi: wifi_strength() }
}

#[cfg(any(target_os = "linux", test))]
fn read_linux_power(root: &std::path::Path) -> (Option<u8>, bool) {
    let mut battery = None;
    let mut charging = false;
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            let kind = std::fs::read_to_string(path.join("type")).unwrap_or_default();
            if kind.trim() != "Battery" { continue; }
            let scope = std::fs::read_to_string(path.join("scope")).unwrap_or_default();
            let present = std::fs::read_to_string(path.join("present")).unwrap_or_default();
            if scope.trim() == "Device" || present.trim() == "0" { continue; }
            if let Ok(value) = std::fs::read_to_string(path.join("capacity")) {
                if let Ok(percent) = value.trim().parse::<u8>() {
                    if percent <= 100 { battery = Some(percent); }
                }
            }
            let status = std::fs::read_to_string(path.join("status")).unwrap_or_default();
            charging = matches!(status.trim(), "Charging" | "Full");
            // Use the first battery with a readable capacity (no invented
            // average between batteries of different physical capacities).
            if battery.is_some() { break; }
        }
    }
    (battery, charging)
}

#[cfg(any(target_os = "linux", test))]
fn parse_nmcli_signal(text: &str) -> Option<u32> {
    text.lines().find_map(|line| {
        let (active, signal) = line.trim().split_once(':')?;
        if active != "*" { return None; }
        signal.parse::<u32>().ok().filter(|n| *n <= 100)
    })
}

#[cfg(target_os = "linux")]
fn wifi_strength() -> Option<u32> {
    use std::io::Read;
    use std::process::Stdio;
    // NetworkManager is optional; absent/disconnected interfaces remain None.
    // --rescan no avoids triggering a new network scan on every refresh.
    let mut child = std::process::Command::new("timeout")
        .args(["--kill-after=1s", "1s", "nmcli", "--terse", "--fields",
            "IN-USE,SIGNAL", "device", "wifi", "list", "--rescan", "no"])
        .env("LC_ALL", "C")
        .stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().ok()?;
    let mut output = Vec::new();
    let read = child.stdout.take()?.take(65_537).read_to_end(&mut output);
    let status = child.wait().ok()?;
    if read.is_err() || !status.success() || output.len() > 65_536 { return None; }
    parse_nmcli_signal(std::str::from_utf8(&output).ok()?)
}

#[cfg(not(any(windows, target_os = "linux")))]
fn read() -> SysStatus {
    SysStatus { battery: None, charging: false, wifi: None }
}

#[cfg(not(any(windows, target_os = "linux")))]
fn wifi_strength() -> Option<u32> { None }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_reports_active_network_with_valid_percentage() {
        assert_eq!(parse_nmcli_signal(":75\n*:42\n:90\n"), Some(42));
        assert_eq!(parse_nmcli_signal(":75\n"), None);
        assert_eq!(parse_nmcli_signal("*:101\n"), None);
        assert_eq!(parse_nmcli_signal("*:invalid\n"), None);
    }

    #[test]
    fn reads_sysfs_battery_and_handles_missing_or_invalid_capacity() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("dynisland-power-{}-{unique}", std::process::id()));
        let battery = root.join("BAT0");
        std::fs::create_dir_all(&battery).unwrap();
        std::fs::write(battery.join("type"), "Battery\n").unwrap();
        std::fs::write(battery.join("capacity"), "74\n").unwrap();
        std::fs::write(battery.join("status"), "Charging\n").unwrap();
        assert_eq!(read_linux_power(&root), (Some(74), true));
        std::fs::write(battery.join("status"), "Discharging\n").unwrap();
        assert_eq!(read_linux_power(&root), (Some(74), false));
        std::fs::write(battery.join("capacity"), "101\n").unwrap();
        assert_eq!(read_linux_power(&root).0, None);
        std::fs::write(battery.join("capacity"), "74\n").unwrap();
        std::fs::write(battery.join("scope"), "Device\n").unwrap();
        assert_eq!(read_linux_power(&root), (None, false));
        std::fs::remove_dir_all(&root).unwrap();
        assert_eq!(read_linux_power(&root), (None, false));
    }
}

pub fn spawn(app: AppHandle) {
    thread::spawn(move || {
        let mut last: Option<SysStatus> = None;
        loop {
            let s = read();
            if last.as_ref() != Some(&s) {
                last = Some(s.clone());
                let _ = app.emit("sys-status", &s);
            }
            thread::sleep(Duration::from_secs(60));
        }
    });
}

// Async: la consulta WLAN puede tardar unos ms; nunca en el hilo principal.
#[tauri::command]
pub async fn get_status() -> SysStatus {
    tauri::async_runtime::spawn_blocking(read)
        .await
        .unwrap_or(SysStatus { battery: None, charging: false, wifi: None })
}
