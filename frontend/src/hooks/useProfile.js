// useProfile.js — 个人资料（昵称/头像）状态与处理
import { useState } from "react";
import { updateProfile } from "../api.js";
import { readAvatar } from "../utils/imageCompress.js";

export function useProfile({ token, profile, setProfile, nickInput, setNickInput, avatarPreview, setAvatarPreview }) {
  const [profileMsg, setProfileMsg] = useState(null);
  const [profileBusy, setProfileBusy] = useState(false);

  // ---------- 个人资料（昵称/头像） ----------
  async function handlePickAvatar(fileList) {
    const file = fileList && fileList[0];
    if (!file) return;
    setProfileMsg(null);
    try {
      setAvatarPreview(await readAvatar(file));
    } catch (err) {
      setProfileMsg({ type: "err", text: err.message });
    }
  }

  async function handleSaveProfile(e) {
    e.preventDefault();
    setProfileBusy(true);
    setProfileMsg(null);
    try {
      const d = await updateProfile(
        {
          nickname: nickInput.trim(),
          // 只有本地预览与已保存头像不同才提交头像字段（null = 保持不变）
          avatar: avatarPreview === profile.avatar ? null : avatarPreview,
        },
        token
      );
      setProfile({ nickname: d.nickname, avatar: d.avatar });
      setNickInput(d.nickname);
      setAvatarPreview(d.avatar);
      setProfileMsg({ type: "ok", text: "个人资料已保存" });
    } catch (err) {
      setProfileMsg({ type: "err", text: err.message });
    } finally {
      setProfileBusy(false);
    }
  }
  return { nickInput, setNickInput, avatarPreview, setAvatarPreview, profileMsg, profileBusy, handlePickAvatar, handleSaveProfile };
}
