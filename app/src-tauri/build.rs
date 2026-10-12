use std::fs;

fn main() {
    let icon_dir = std::path::Path::new("icons");
    fs::create_dir_all(icon_dir).expect("create app icon directory");

    let mut rgba = vec![0_u8; 32 * 32 * 4];
    for y in 0..32 {
        for x in 0..32 {
            let dx = x as i32 - 15;
            let dy = y as i32 - 15;
            let distance = dx * dx + dy * dy;
            let color = if (distance > 52 && distance < 180) || distance < 28 {
                [130, 226, 180, 255]
            } else if distance < 235 {
                [24, 38, 34, 255]
            } else {
                [0, 0, 0, 0]
            };
            let offset = (y * 32 + x) * 4;
            rgba[offset..offset + 4].copy_from_slice(&color);
        }
    }

    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, 32, 32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().expect("encode app icon header");
        writer
            .write_image_data(&rgba)
            .expect("encode app icon pixels");
    }
    fs::write(icon_dir.join("icon.png"), png_bytes).expect("write app icon");

    tauri_build::build();
}
