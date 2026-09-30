// useAiConfig.js — 模型配置（root）状态与处理：连接设置 / 连通性测试 / 模型列表 / 提示词
import { useEffect, useState } from "react";
import { getAiSettings, saveAiSettings, testAi, listAiModels, saveAiPrompts, resetAiPrompts } from "../api.js";

export function useAiConfig({ token, setError, tab }) {
  const [aiMeta, setAiMeta] = useState(null);
  const [aiForm, setAiForm] = useState({ provider: "custom", base_url: "", model: "", searchProvider: "bing" });
  const [aiKey, setAiKey] = useState("");
  const [aiSearchKey, setAiSearchKey] = useState("");
  const [aiPrompts, setAiPrompts] = useState(null);
  const [aiModels, setAiModels] = useState([]);
  const [aiMsg, setAiMsg] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiAct, setAiAct] = useState(""); // 当前进行中的 AI 设置操作（save/test/models/prompts/reset），用于按钮 spinner
  const [promptViews, setPromptViews] = useState({});

  useEffect(() => {
    if (tab === "cfg_model" && token && !aiMeta) {
      loadAiSettings();
    }
  }, [tab, token, aiMeta]);

  async function loadAiSettings() {
    setError("");
    try {
      const d = await getAiSettings(token);
      setAiMeta(d);
      setAiForm({
        provider: d.config.provider,
        base_url: d.config.base_url,
        model: d.config.model,
        searchProvider: d.config.search.provider
      });
      setAiPrompts(d.prompts);
      const p = d.providers.find((x) => x.id === d.config.provider);
      setAiModels(p ? p.models.map((m) => m.id) : []);
    } catch (err) {
      setError(err.message);
    }
  }

  function pickProvider(pid) {
    const p = aiMeta.providers.find((x) => x.id === pid);
    setAiForm((f) => ({
      ...f,
      provider: pid,
      base_url: p && p.base_url ? p.base_url : f.base_url,
      model: p && p.default_model ? p.default_model : f.model
    }));
    setAiModels(p ? p.models.map((m) => m.id) : []);
  }

  async function handleAiSave(e) {
    e.preventDefault();
    setAiBusy(true);
    setAiAct("save");
    setAiMsg(null);
    setError("");
    try {
      const d = await saveAiSettings(
        {
          provider: aiForm.provider,
          base_url: aiForm.base_url,
          model: aiForm.model,
          api_key: aiKey,
          search_provider: aiForm.searchProvider,
          search_api_key: aiSearchKey
        },
        token
      );
      setAiForm((f) => ({
        ...f,
        provider: d.config.provider,
        base_url: d.config.base_url,
        model: d.config.model,
        searchProvider: d.config.search.provider
      }));
      setAiKey("");
      setAiSearchKey("");
      setAiMeta((m) => (m ? { ...m, config: d.config } : m));
      setAiMsg({ type: "ok", text: "连接设置已保存，立即生效" });
    } catch (err) {
      setAiMsg({ type: "err", text: err.message });
    } finally {
      setAiBusy(false);
      setAiAct("");
    }
  }

  async function handleAiTest() {
    setAiBusy(true);
    setAiAct("test");
    setAiMsg(null);
    try {
      const d = await testAi(
        { provider: aiForm.provider, base_url: aiForm.base_url, model: aiForm.model, api_key: aiKey },
        token
      );
      setAiMsg(
        d.ok
          ? { type: "ok", text: `连接成功（${d.latency_ms}ms）` }
          : { type: "err", text: `连接失败：${d.error}` }
      );
    } catch (err) {
      setAiMsg({ type: "err", text: err.message });
    } finally {
      setAiBusy(false);
      setAiAct("");
    }
  }

  async function handleAiModels() {
    setAiBusy(true);
    setAiAct("models");
    setAiMsg(null);
    try {
      const d = await listAiModels(
        { provider: aiForm.provider, base_url: aiForm.base_url, api_key: aiKey },
        token
      );
      setAiModels(d.models);
      setAiMsg(
        d.ok
          ? { type: "ok", text: `已获取 ${d.models.length} 个可用模型（输入框可下拉选择）` }
          : { type: "err", text: d.error || "获取模型列表失败" }
      );
    } catch (err) {
      setAiMsg({ type: "err", text: err.message });
    } finally {
      setAiBusy(false);
      setAiAct("");
    }
  }

  async function handleSavePrompts() {
    setAiBusy(true);
    setAiAct("prompts");
    setAiMsg(null);
    try {
      await saveAiPrompts(aiPrompts, token);
      setAiMsg({ type: "ok", text: "提示词已保存，下次 AI 分析即生效" });
    } catch (err) {
      setAiMsg({ type: "err", text: err.message });
    } finally {
      setAiBusy(false);
      setAiAct("");
    }
  }

  async function handleResetPrompts() {
    setAiBusy(true);
    setAiAct("reset");
    setAiMsg(null);
    try {
      const d = await resetAiPrompts(token);
      setAiPrompts(d.prompts);
      setAiMsg({ type: "ok", text: "已恢复默认提示词" });
    } catch (err) {
      setAiMsg({ type: "err", text: err.message });
    } finally {
      setAiBusy(false);
      setAiAct("");
    }
  }
  return {
    aiMeta, aiForm, setAiForm, aiKey, setAiKey, aiSearchKey, setAiSearchKey, aiPrompts, setAiPrompts, aiModels,
    aiMsg, aiBusy, aiAct, promptViews, setPromptViews,
    pickProvider, handleAiSave, handleAiTest, handleAiModels, handleSavePrompts, handleResetPrompts,
  };
}
