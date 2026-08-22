use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySourceDescriptor {
    pub id: &'static str,
    pub label: &'static str,
    pub available: bool,
    pub detail: String,
    pub privacy: &'static str,
}

trait ActivitySource {
    fn descriptor(&self) -> ActivitySourceDescriptor;
}

struct WindowSource;
struct ActivityWatchSource;
struct JsonFileSource;

impl ActivitySource for WindowSource {
    fn descriptor(&self) -> ActivitySourceDescriptor {
        let (available, detail) = crate::system::window_capture_capability();
        ActivitySourceDescriptor {
            id: "window",
            label: "当前窗口",
            available,
            detail,
            privacy: "读取当前窗口元数据；窗口控件文本仅在 Windows 可用",
        }
    }
}

impl ActivitySource for ActivityWatchSource {
    fn descriptor(&self) -> ActivitySourceDescriptor {
        ActivitySourceDescriptor {
            id: "activitywatch",
            label: "内置 ActivityWatch",
            available: crate::aw::internal_server_available(),
            detail: "由墨记启动并管理本地 ActivityWatch 服务".to_string(),
            privacy: "只访问本机 127.0.0.1 上由墨记校验身份的服务",
        }
    }
}

impl ActivitySource for JsonFileSource {
    fn descriptor(&self) -> ActivitySourceDescriptor {
        ActivitySourceDescriptor {
            id: "json_file",
            label: "JSON 文件",
            available: true,
            detail: "仅在用户主动选择文件时读取".to_string(),
            privacy: "不会监视目录或自动读取其他文件",
        }
    }
}

#[tauri::command]
pub fn list_activity_sources() -> Vec<ActivitySourceDescriptor> {
    let sources: [&dyn ActivitySource; 3] = [&WindowSource, &ActivityWatchSource, &JsonFileSource];
    sources
        .into_iter()
        .map(ActivitySource::descriptor)
        .collect()
}
