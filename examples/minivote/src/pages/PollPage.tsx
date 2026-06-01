import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { fetchPoll, submitVote } from "../api";
import type { PollDetail } from "../types";
import Card from "../components/Card";
import Button from "../components/Button";
import ShareButton from "../components/ShareButton";
import ToastContainer, { showToast } from "../components/Toast";
import styles from "../styles/pages/Poll.module.css";

export default function PollPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [poll, setPoll] = useState<PollDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchPoll(id)
      .then((data) => {
        setPoll(data);
        if (data.hasVoted) {
          navigate(`/results/${id}`, { replace: true });
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, navigate]);

  const handleVote = async () => {
    if (!id || !selectedOption) {
      showToast("请先选择一个选项", "error");
      return;
    }

    setSubmitting(true);
    try {
      await submitVote(id, selectedOption);
      navigate(`/results/${id}`, { replace: true });
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "投票失败", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.state}>
        <div className={styles.spinner} />
        <p className={styles.stateText}>加载中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.state}>
        <p className={styles.errorIcon}>😞</p>
        <p className={styles.stateText}>加载失败</p>
        <p className={styles.errorDetail}>{error}</p>
      </div>
    );
  }

  if (!poll) return null;

  return (
    <div className={styles.page}>
      <button className={styles.backBtn} onClick={() => navigate("/")}>
        ← 返回
      </button>

      <div className={styles.heading}>
        <h1 className={styles.title}>{poll.title}</h1>
        <p className={styles.subtitle}>
          请选择一个选项 · {poll.totalVotes} 人已投票
        </p>
      </div>

      <div className={styles.optionsList}>
        {poll.options.map((option) => (
          <div
            key={option.id}
            className={`${styles.option} ${selectedOption === option.id ? styles.selected : ""}`}
            onClick={() => setSelectedOption(option.id)}
            role="radio"
            aria-checked={selectedOption === option.id}
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && setSelectedOption(option.id)}
          >
            <div className={styles.radio}>
              <div className={`${styles.radioDot} ${selectedOption === option.id ? styles.radioDotActive : ""}`} />
            </div>
            <span className={styles.optionText}>{option.text}</span>
          </div>
        ))}
      </div>

      <div className={styles.actions}>
        <Button
          onClick={handleVote}
          disabled={!selectedOption || submitting}
          fullWidth
          size="lg"
        >
          {submitting ? "投票中..." : "提交投票"}
        </Button>
        <div className={styles.shareRow}>
          <ShareButton pollId={poll.id} />
        </div>
      </div>

      <ToastContainer />
    </div>
  );
}
