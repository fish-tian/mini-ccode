import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPoll } from "../api";
import Card from "../components/Card";
import Button from "../components/Button";
import Input from "../components/Input";
import ToastContainer, { showToast } from "../components/Toast";
import styles from "../styles/pages/Create.module.css";

export default function CreatePage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [submitting, setSubmitting] = useState(false);

  const addOption = () => {
    setOptions([...options, ""]);
  };

  const removeOption = (index: number) => {
    if (options.length <= 2) return;
    setOptions(options.filter((_, i) => i !== index));
  };

  const updateOption = (index: number, value: string) => {
    const next = [...options];
    next[index] = value;
    setOptions(next);
  };

  const handleSubmit = async () => {
    const trimmedTitle = title.trim();
    const trimmedOptions = options.map((o) => o.trim()).filter((o) => o.length > 0);

    if (!trimmedTitle) {
      showToast("请输入投票标题", "error");
      return;
    }
    if (trimmedOptions.length < 2) {
      showToast("至少需要两个非空选项", "error");
      return;
    }

    setSubmitting(true);
    try {
      const { id } = await createPoll({ title: trimmedTitle, options: trimmedOptions });
      navigate(`/poll/${id}`);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "创建失败", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <h1 className={styles.title}>创建新投票</h1>
        <p className={styles.subtitle}>填写标题和选项，让朋友来投票</p>
      </div>

      <Card>
        <div className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label}>投票标题</label>
            <Input
              value={title}
              onChange={setTitle}
              placeholder="输入一个清晰的问题..."
              autoFocus
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>
              选项
              <span className={styles.labelHint}>（至少 2 个）</span>
            </label>
            <div className={styles.optionsList}>
              {options.map((opt, i) => (
                <div key={i} className={styles.optionRow}>
                  <span className={styles.optionIndex}>{i + 1}</span>
                  <div className={styles.optionInput}>
                    <Input
                      value={opt}
                      onChange={(v) => updateOption(i, v)}
                      placeholder={`选项 ${i + 1}`}
                    />
                  </div>
                  <button
                    className={styles.removeBtn}
                    onClick={() => removeOption(i)}
                    disabled={options.length <= 2}
                    title="删除此选项"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button className={styles.addBtn} onClick={addOption}>
              + 添加选项
            </button>
          </div>

          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => navigate("/")}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? "创建中..." : "创建投票"}
            </Button>
          </div>
        </div>
      </Card>

      <ToastContainer />
    </div>
  );
}
