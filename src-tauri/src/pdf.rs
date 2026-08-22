use printpdf::{
    path::PaintMode, Color, IndirectFontRef, Mm, PdfDocument, PdfDocumentReference,
    PdfLayerReference, Rect, Rgb,
};
use serde::Deserialize;
use std::{
    fs::File,
    io::{BufReader, BufWriter},
    path::{Path, PathBuf},
};
use tauri_plugin_dialog::DialogExt;

const PAGE_WIDTH: f32 = 210.0;
const PAGE_HEIGHT: f32 = 297.0;
const MARGIN: f32 = 18.0;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfStat {
    label: String,
    value: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfReportRequest {
    title: String,
    report_type: String,
    created_at: String,
    mode: String,
    template: String,
    content: String,
    activity_count: u64,
    categories: Vec<PdfStat>,
    top_apps: Vec<PdfStat>,
}

fn font_candidates() -> Vec<PathBuf> {
    if cfg!(target_os = "windows") {
        vec![
            PathBuf::from(r"C:\Windows\Fonts\simhei.ttf"),
            PathBuf::from(r"C:\Windows\Fonts\msyh.ttc"),
            PathBuf::from(r"C:\Windows\Fonts\simsun.ttc"),
        ]
    } else if cfg!(target_os = "macos") {
        vec![
            PathBuf::from("/System/Library/Fonts/PingFang.ttc"),
            PathBuf::from("/System/Library/Fonts/STHeiti Light.ttc"),
        ]
    } else {
        vec![
            PathBuf::from("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
            PathBuf::from("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"),
            PathBuf::from("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        ]
    }
}

fn load_font(doc: &PdfDocumentReference) -> Result<IndirectFontRef, String> {
    for path in font_candidates() {
        if !path.is_file() {
            continue;
        }
        let file = File::open(&path).map_err(|error| format!("打开 PDF 字体失败：{error}"))?;
        if let Ok(font) = doc.add_external_font(&mut BufReader::new(file)) {
            return Ok(font);
        }
    }
    Err("未找到可用于 PDF 的中文字体，请安装微软雅黑、苹方或 Noto Sans CJK".to_string())
}

fn wrap_text(text: &str, max_units: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current = String::new();
    let mut units = 0;
    for character in text.chars() {
        let width = if character.is_ascii() { 1 } else { 2 };
        if units + width > max_units && !current.is_empty() {
            if let Some(index) = current.rfind(char::is_whitespace) {
                let remainder = current[index..].to_string();
                let completed = current[..index].to_string();
                if !completed.is_empty() {
                    lines.push(completed);
                    current = remainder;
                    units = current
                        .chars()
                        .map(|value| if value.is_ascii() { 1 } else { 2 })
                        .sum();
                } else {
                    lines.push(current);
                    current = String::new();
                    units = 0;
                }
            } else {
                lines.push(current);
                current = String::new();
                units = 0;
            }
        }
        current.push(character);
        units += width;
    }
    if !current.is_empty() {
        lines.push(current);
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

fn strip_inline_markdown(value: &str) -> String {
    value.replace("**", "").replace("__", "").replace('`', "")
}

fn clean_markdown_line(line: &str) -> (String, f32, f32) {
    let trimmed = line.trim();
    if let Some(value) = trimmed.strip_prefix("### ") {
        (strip_inline_markdown(value), 12.0, 0.0)
    } else if let Some(value) = trimmed.strip_prefix("## ") {
        (strip_inline_markdown(value), 14.0, 0.0)
    } else if let Some(value) = trimmed.strip_prefix("# ") {
        (strip_inline_markdown(value), 17.0, 0.0)
    } else if let Some(value) = trimmed
        .strip_prefix("- ")
        .or_else(|| trimmed.strip_prefix("* "))
    {
        (strip_inline_markdown(value), 10.0, 4.0)
    } else {
        (strip_inline_markdown(trimmed), 10.0, 0.0)
    }
}

fn add_page(doc: &PdfDocumentReference, name: &str) -> PdfLayerReference {
    let (page, layer) = doc.add_page(Mm(PAGE_WIDTH), Mm(PAGE_HEIGHT), name);
    doc.get_page(page).get_layer(layer)
}

fn draw_bar(layer: &PdfLayerReference, x: f32, y: f32, width: f32, color: (f32, f32, f32)) {
    layer.set_fill_color(Color::Rgb(Rgb::new(color.0, color.1, color.2, None)));
    layer.add_rect(Rect::new(Mm(x), Mm(y - 3.5), Mm(x + width), Mm(y)).with_mode(PaintMode::Fill));
}

fn draw_footer(
    layer: &PdfLayerReference,
    font: &IndirectFontRef,
    page_number: u32,
    generated_at: &str,
) {
    layer.set_fill_color(Color::Rgb(Rgb::new(0.42, 0.46, 0.45, None)));
    layer.use_text(
        format!("墨记 - 第 {page_number} 页 - 生成于 {generated_at}"),
        8.0,
        Mm(MARGIN),
        Mm(8.0),
        font,
    );
}

fn render_pdf(path: &Path, request: PdfReportRequest) -> Result<(), String> {
    let (doc, first_page, first_layer) = PdfDocument::new(
        request.title.trim(),
        Mm(PAGE_WIDTH),
        Mm(PAGE_HEIGHT),
        "墨记报告",
    );
    let font = load_font(&doc)?;
    let mut layer = doc.get_page(first_page).get_layer(first_layer);
    let mut page_number = 1u32;
    let mut y = PAGE_HEIGHT - MARGIN;

    layer.set_fill_color(Color::Rgb(Rgb::new(0.10, 0.18, 0.16, None)));
    layer.add_rect(
        Rect::new(
            Mm(0.0),
            Mm(PAGE_HEIGHT - 48.0),
            Mm(PAGE_WIDTH),
            Mm(PAGE_HEIGHT),
        )
        .with_mode(PaintMode::Fill),
    );
    layer.set_fill_color(Color::Rgb(Rgb::new(1.0, 1.0, 1.0, None)));
    layer.use_text("墨记", 13.0, Mm(MARGIN), Mm(y), &font);
    y -= 12.0;
    layer.use_text(request.title.trim(), 22.0, Mm(MARGIN), Mm(y), &font);
    y -= 12.0;
    layer.use_text(
        format!(
            "{} · {} · {} · {}",
            request.report_type, request.created_at, request.mode, request.template
        ),
        9.0,
        Mm(MARGIN),
        Mm(y),
        &font,
    );
    y = PAGE_HEIGHT - 62.0;

    layer.set_fill_color(Color::Rgb(Rgb::new(0.12, 0.18, 0.17, None)));
    layer.use_text(
        format!("活动记录  {} 条", request.activity_count),
        13.0,
        Mm(MARGIN),
        Mm(y),
        &font,
    );
    y -= 10.0;

    if !request.categories.is_empty() {
        layer.use_text("分类分布", 13.0, Mm(MARGIN), Mm(y), &font);
        y -= 8.0;
        let maximum = request
            .categories
            .iter()
            .map(|item| item.value)
            .max()
            .unwrap_or(1)
            .max(1) as f32;
        let colors = [
            (0.16, 0.55, 0.45),
            (0.24, 0.46, 0.78),
            (0.88, 0.55, 0.18),
            (0.75, 0.31, 0.42),
            (0.45, 0.48, 0.50),
        ];
        for (index, item) in request.categories.iter().take(6).enumerate() {
            layer.use_text(
                format!("{}  {}", item.label, item.value),
                9.0,
                Mm(MARGIN),
                Mm(y),
                &font,
            );
            draw_bar(
                &layer,
                62.0,
                y + 1.0,
                105.0 * item.value as f32 / maximum,
                colors[index % colors.len()],
            );
            y -= 7.0;
        }
        y -= 4.0;
    }

    if !request.top_apps.is_empty() {
        layer.set_fill_color(Color::Rgb(Rgb::new(0.12, 0.18, 0.17, None)));
        layer.use_text("主要应用", 13.0, Mm(MARGIN), Mm(y), &font);
        y -= 8.0;
        for item in request.top_apps.iter().take(8) {
            layer.use_text(format!("{}", item.label), 9.0, Mm(MARGIN), Mm(y), &font);
            layer.use_text(format!("{} 条", item.value), 9.0, Mm(170.0), Mm(y), &font);
            y -= 6.5;
        }
        y -= 4.0;
    }

    layer.set_fill_color(Color::Rgb(Rgb::new(0.12, 0.18, 0.17, None)));
    layer.use_text("报告正文", 14.0, Mm(MARGIN), Mm(y), &font);
    y -= 9.0;

    for raw_line in request.content.replace("\r\n", "\n").lines() {
        let (cleaned, size, indent) = clean_markdown_line(raw_line);
        if cleaned.is_empty() {
            y -= 3.0;
            continue;
        }
        let max_units = if indent > 0.0 { 70 } else { 76 };
        let wrapped_lines = wrap_text(&cleaned, max_units);
        let line_height = if size >= 14.0 {
            7.0
        } else if size >= 12.0 {
            6.5
        } else {
            5.0
        };
        let paragraph_height =
            wrapped_lines.len() as f32 * line_height + if size >= 12.0 { 2.0 } else { 0.0 };
        if y - paragraph_height < MARGIN + 12.0
            && paragraph_height < PAGE_HEIGHT - MARGIN * 2.0 - 12.0
        {
            draw_footer(&layer, &font, page_number, &request.created_at);
            page_number += 1;
            layer = add_page(&doc, &format!("墨记报告第 {page_number} 页"));
            y = PAGE_HEIGHT - MARGIN;
        }
        for (index, wrapped) in wrapped_lines.into_iter().enumerate() {
            if y < MARGIN + 12.0 {
                draw_footer(&layer, &font, page_number, &request.created_at);
                page_number += 1;
                layer = add_page(&doc, &format!("墨记报告第 {page_number} 页"));
                y = PAGE_HEIGHT - MARGIN;
            }
            layer.set_fill_color(Color::Rgb(Rgb::new(0.12, 0.18, 0.17, None)));
            let prefix = if indent > 0.0 && index == 0 { "- " } else { "" };
            layer.use_text(
                format!("{prefix}{wrapped}"),
                size,
                Mm(MARGIN + indent),
                Mm(y),
                &font,
            );
            y -= line_height;
        }
        if size >= 12.0 {
            y -= 2.0;
        }
    }

    draw_footer(&layer, &font, page_number, &request.created_at);

    let mut writer =
        BufWriter::new(File::create(path).map_err(|error| format!("创建 PDF 文件失败：{error}"))?);
    doc.save(&mut writer)
        .map_err(|error| format!("保存 PDF 失败：{error}"))
}

fn safe_filename(title: &str) -> String {
    let value: String = title
        .chars()
        .filter(|character| {
            !matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            )
        })
        .take(60)
        .collect();
    if value.trim().is_empty() {
        "墨记报告".to_string()
    } else {
        value
    }
}

#[tauri::command]
pub async fn export_report_pdf(
    app: tauri::AppHandle,
    request: PdfReportRequest,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .set_title("导出墨记 PDF")
            .set_file_name(format!("{}.pdf", safe_filename(&request.title)))
            .add_filter("PDF 文档", &["pdf"])
            .blocking_save_file();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let path = selected
            .into_path()
            .map_err(|error| format!("读取 PDF 保存路径失败：{error}"))?;
        render_pdf(&path, request)?;
        Ok(Some(path.to_string_lossy().to_string()))
    })
    .await
    .map_err(|error| format!("导出 PDF 任务失败：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_chinese_and_ascii_without_losing_text() {
        let source = "墨记 Moji 本地报告导出";
        let wrapped = wrap_text(source, 8);
        assert_eq!(wrapped.concat(), source);
        assert!(wrapped.len() > 1);
        assert!(source.chars().any(|character| !character.is_ascii()));
    }

    #[test]
    fn sanitizes_pdf_filename() {
        assert_eq!(safe_filename("日报: 2026/08/22"), "日报 20260822");
    }

    #[test]
    fn removes_inline_markdown_markers() {
        let (line, _, _) = clean_markdown_line("- **重点**：检查 `MCP` 配置");
        assert_eq!(line, "重点：检查 MCP 配置");
    }

    #[test]
    #[ignore = "writes a visual QA PDF to MOJI_PDF_QA_OUTPUT"]
    fn writes_visual_qa_pdf() {
        let path = std::env::var_os("MOJI_PDF_QA_OUTPUT")
            .map(PathBuf::from)
            .expect("MOJI_PDF_QA_OUTPUT must be set");
        let detail_sections = (1..=7)
            .map(|index| {
                format!(
                    "## 验收记录 {index}\n\n- 检查第 {index} 组跨平台构建、窗口布局和系统通知。\n- English configuration names remain intact when a line wraps near the page margin."
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        let request = PdfReportRequest {
            title: "墨记周报-2026-08-19".to_string(),
            report_type: "周报".to_string(),
            created_at: "2026/8/22 10:45:00".to_string(),
            mode: "固定格式模式".to_string(),
            template: "标准复盘".to_string(),
            content: format!(
                "# 本周总结\n\n本周围绕 ActivityWatch、SQLite 和 Tauri 完成平台能力整合。\n\n## 关键进展\n\n- **本地只读 API** 与 `MCP` 共用查询层。\n- 加密同步采用 AES-256-GCM，密钥派生采用 Argon2。\n- YAML configuration and cross-platform packaging remain readable without splitting English words.\n\n{detail_sections}\n\n## 下周行动\n\n- 验证 Windows、macOS 与 Linux 构建。\n- 检查窄窗口布局与系统通知。\n- 完成 README 和发布清单。\n\n## 风险与说明\n\n窗口原文、截图、API Key 和同步密码不会进入报告或同步快照。"
            ),
            activity_count: 128,
            categories: vec![
                PdfStat { label: "开发".to_string(), value: 62 },
                PdfStat { label: "文档".to_string(), value: 31 },
                PdfStat { label: "沟通".to_string(), value: 20 },
                PdfStat { label: "其他".to_string(), value: 15 },
            ],
            top_apps: vec![
                PdfStat { label: "Visual Studio Code".to_string(), value: 48 },
                PdfStat { label: "Obsidian".to_string(), value: 30 },
                PdfStat { label: "Google Chrome".to_string(), value: 24 },
                PdfStat { label: "墨记".to_string(), value: 18 },
            ],
        };
        render_pdf(&path, request).expect("render visual QA PDF");
        assert!(std::fs::metadata(path).expect("read visual QA PDF").len() > 10_000);
    }
}
