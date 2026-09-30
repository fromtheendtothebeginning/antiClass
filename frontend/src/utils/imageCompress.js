// imageCompress.js — 本地图片压缩（canvas）：头像 192px 方形、背景图案 ≤1600px 等比

export const AVATAR_PX = 192; // 头像上传前压到的边长（后端按 data URL 长度也有限制）
export const PATTERN_PX = 1600; // 自定义图案压到的最大边长（按屏幕宽度铺满整屏，源图太小会糊）
export const PATTERN_MAX_CHARS = 800000; // 压完超过这个长度就退回 JPEG（后端上限 1200000 字符）

/** 选择本地图片 → 居中裁剪成正方形 → 压到 192px JPEG data URL（头像存储与展示都用它） */
export function readAvatar(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement("canvas");
      canvas.width = AVATAR_PX;
      canvas.height = AVATAR_PX;
      canvas
        .getContext("2d")
        .drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读取失败，请换一张图片"));
    };
    img.src = url;
  });
}

/** 选择图案图片 → 等比压到 ≤1600px（按屏幕宽度铺满，源图太小会糊）；PNG/WebP/GIF 保留原样编码以保住透明通道，
    压完仍过大（照片类）则退回 JPEG；JPEG 源直接按 JPEG 压 */
export function readPatternImage(file) {
  return new Promise((resolve, reject) => {
    const lossless = /png|webp|gif/i.test(file.type || "");
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, PATTERN_PX / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      if (!lossless) return resolve(canvas.toDataURL("image/jpeg", 0.85));
      const png = canvas.toDataURL("image/png");
      resolve(png.length > PATTERN_MAX_CHARS ? canvas.toDataURL("image/jpeg", 0.85) : png);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读取失败，请换一张图片"));
    };
    img.src = url;
  });
}
