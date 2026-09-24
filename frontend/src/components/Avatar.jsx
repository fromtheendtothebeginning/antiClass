/**
 * 账号头像：有头像图（data URL）显示图片，否则显示昵称/用户名首字。
 *
 * 头像统一为正方形居中裁剪（上传时前端已压到 192px），这里只管圆形显示。
 *
 * @param {string} [avatar] - data URL（后端 /api/me 返回）
 * @param {string} [nickname] - 昵称（优先作为首字来源）
 * @param {string} [username] - 用户名（无昵称时的首字来源）
 * @param {number} [size=40] - 直径像素
 */
export default function Avatar({ avatar = "", nickname = "", username = "", size = 40 }) {
  const initial = (nickname || username || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {avatar ? <img src={avatar} alt="" /> : initial}
    </span>
  );
}
