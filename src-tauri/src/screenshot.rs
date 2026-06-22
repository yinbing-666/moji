use std::io::Cursor;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use screenshots::{image::ImageOutputFormat, Screen};

#[tauri::command]
pub fn take_screenshot() -> Result<String, String> {
    let screen = primary_screen()?;
    let image = screen
        .capture()
        .map_err(|error| format!("Failed to capture screenshot: {error}"))?;

    let mut png_bytes = Cursor::new(Vec::new());
    screenshots::image::DynamicImage::ImageRgba8(image)
        .write_to(&mut png_bytes, ImageOutputFormat::Png)
        .map_err(|error| format!("Failed to encode screenshot as PNG: {error}"))?;

    Ok(STANDARD.encode(png_bytes.into_inner()))
}

fn primary_screen() -> Result<Screen, String> {
    let mut screens =
        Screen::all().map_err(|error| format!("Failed to enumerate screens: {error}"))?;

    let primary_index = screens
        .iter()
        .position(|screen| screen.display_info.is_primary)
        .unwrap_or(0);

    if screens.is_empty() {
        return Err("No screens available for capture".to_string());
    }

    Ok(screens.swap_remove(primary_index))
}
